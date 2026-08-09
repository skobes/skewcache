# Skewcache

Skewcache mixes downlevel assets into your `dist/` when you deploy to
[Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/),
so that active client sessions from a previous deployment can still fetch
delay-loaded JavaScript or similar static resources.

Install: `npm install -D skewcache`

You will also need [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
installed.

## Usage

First, configure your bundler to put assets under a versioned path like
`/r.123/foo.js`:

```js
// vite.config.js
import { assetDir } from "skewcache";
import { defineConfig } from "vite";

const dir = assetDir(); // "r.123"

export default defineConfig(() => {
  return { build: { rolldownOptions: { output: {
    assetFileNames: `${dir}/[name][extname]`,
    chunkFileNames: `${dir}/[name].js`,
    entryFileNames: `${dir}/main.js`
  } } } };
});
```

The `assetDir()` helper generates a monotonic version number using
`git rev-list --count HEAD`. (Note that a versioned path prefix means
we don't need a content hash in the filename.)

Next, hook Skewcache up to your `package.json` scripts like this:

```js
{
  ...
  "scripts": {
    ...
    "predeploy": "skewcache predeploy",
    "deploy": "wrangler deploy",
    "postdeploy": "skewcache postdeploy"
  }
  ...
}
```

Two steps invoke Skewcache:
* The `predeploy` command downloads a cache of assets from prior deployments
and copies them into `dist/`, so that `wrangler deploy` sees the entire set.
* The `postdeploy` command uploads a new cache that includes the deployment that
just finished.

By default the cache is stored in R2 as `skewcache/myproject`. You can plug
in your own storage backend through `skewcache.config.js` if you want to do
something different.

Deployments more than a week old are discarded, so the cache doesn't grow
unbounded. However, the previous deployment is always kept, regardless
of age. The 1-week threshold can be configured.

The skewcache CLI looks for `r.N` asset dirs by default but can be configured
to match any pattern. You can pass a custom format to `assetDir()` or roll your
own. Versions don't have to be ordered, so you could e.g. use a SHA hash instead
of a monotonic counter.

## Configuration

You can customize skewcache with `skewcache.config.js` or any of the variations
that [cosmiconfig](https://github.com/cosmiconfig/cosmiconfig) looks for.

```js
// skewcache.config.js
export default {
  name: "myproject", // defaults to name from package.json
  bucket: "skewcache", // R2 bucket for the cache
  dist: "dist", // build output directory
  tmp: ".deploytmp", // temp working directory
  maxAge: { days: 7 }, // prune entries older than this, except the newest
  assetDir: /^r\.\d+$/, // regex matching the revision directory in `dist`
  storage: cfg => ({
    description: cfg.name,
    async get(file) { ... },
    async put(file) { ... }
  })
};
```

All of these except `storage` can also be specified as command-line flags
(`skewcache --help` for details).
