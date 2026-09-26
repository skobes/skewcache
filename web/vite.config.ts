import { defineConfig, type Plugin } from "vite";
import { minify } from "html-minifier-terser";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { cloudflare } from "@cloudflare/vite-plugin";
import { assetDir } from "skewcache";

function minifyHtml(): Plugin {
  const handler = (html: string) => minify(html, {
    collapseWhitespace: true,
    removeComments: true
  });
  const transformIndexHtml = { order: "post" as const, handler };
  return { name: "minify-html", transformIndexHtml };
}

const staticCopyTargets = [{
  src: [ "favicon.ico", "robots.txt", "_headers" ],
  dest: "."
}];

export default defineConfig({
  plugins: [
    cloudflare(),
    minifyHtml(),
    viteStaticCopy({ targets: staticCopyTargets })
  ],
  build: {
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: [ "index.html", "404.html" ],
      output: {
        assetFileNames: `${assetDir()}/[name][extname]`,
        chunkFileNames: `${assetDir()}/[name].js`,
        entryFileNames: `${assetDir()}/[name].js`
      }
    }
  }
});
