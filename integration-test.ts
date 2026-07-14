// Exercises skewcache.ts end-to-end against the real wrangler CLI in local mode
// (--local), which round-trips objects through wrangler's simulated R2 storage
// under .wrangler/state.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import spawn, { SubprocessError } from "nano-spawn";

const pkgDir = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(pkgDir, "main.ts");
// The test project has no wrangler dependency of its own, and preferLocal
// searches upward from the temp project's cwd, so it won't find this
// package's node_modules. Putting our node_modules/.bin on PATH lets the
// spawned skewcache resolve wrangler there.
const binDir = path.join(pkgDir, "node_modules", ".bin");

test("skewcache round-trips revisions through wrangler's local R2", async (t) => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "skewcache-itest-"));
  t.after(() => fs.rmSync(proj, { recursive: true, force: true }));

  // Mimics zx's nothrow mode: a failed run resolves to the SubprocessError,
  // which carries the same stdout/stderr/exitCode fields as a success.
  const run = async (...args: string[]) => {
    try {
      const result = await spawn("node", ["--harmony-temporal", cli, ...args, "--local"], {
        cwd: proj,
        env: { PATH: `${binDir}${path.delimiter}${process.env.PATH}` },
      });
      return { ...result, exitCode: 0 };
    } catch (err) {
      if (err instanceof SubprocessError) return err;
      throw err;
    }
  };

  fs.writeFileSync(path.join(proj, "package.json"), '{ "name": "skewcache-itest" }\n');
  const makeBuild = (rev: number) => {
    fs.rmSync(path.join(proj, "dist"), { recursive: true, force: true });
    fs.mkdirSync(path.join(proj, "dist", `r.${rev}`), { recursive: true });
    fs.writeFileSync(path.join(proj, "dist", `r.${rev}`, "app.js"), `asset-v${rev}\n`);
  };

  await t.test("deploy 1: starts with empty cache, uploads r.1", async () => {
    makeBuild(1);
    const pre = await run("predeploy");
    assert.equal(pre.exitCode, 0, pre.stderr);
    assert.match(pre.stderr, /starting with empty skewcache/);
    assert.doesNotMatch(pre.stderr, /Restoring recent skew revisions/, "quiet by default: no step headers");
    assert.doesNotMatch(pre.stderr, /wrangler/i, "quiet by default: no wrangler output");

    const post = await run("postdeploy");
    assert.equal(post.exitCode, 0, post.stderr);
    assert.ok(!fs.existsSync(path.join(proj, ".deploytmp")), ".deploytmp cleaned up");
  });

  await t.test("deploy 2: fetches the cache and restores r.1 alongside r.2", async () => {
    makeBuild(2);
    const pre = await run("predeploy", "--verbose");
    assert.equal(pre.exitCode, 0, pre.stderr);
    assert.match(pre.stdout, /Restoring recent skew revisions/, "verbose shows step headers");
    assert.match(pre.stdout, /restoring \^\d{8}-r\.1 -> dist\/r\.1/, "r.1 is marked newest");
    assert.equal(
      fs.readFileSync(path.join(proj, "dist", "r.1", "app.js"), "utf8"),
      "asset-v1\n",
    );

    const post = await run("postdeploy");
    assert.equal(post.exitCode, 0, post.stderr);
  });

  await t.test("deploy 3: cache now carries both r.1 and r.2", async () => {
    makeBuild(3);
    const pre = await run("predeploy");
    assert.equal(pre.exitCode, 0, pre.stderr);
    for (const rev of [1, 2, 3]) {
      assert.ok(fs.existsSync(path.join(proj, "dist", `r.${rev}`)), `dist/r.${rev} present`);
    }
    // Exactly one entry carries the "^" newest marker: the fresh build.
    const marked = fs
      .readdirSync(path.join(proj, ".deploytmp", "skewcache"))
      .filter((n) => n.startsWith("^"));
    assert.equal(marked.length, 1);
    assert.match(marked[0], /^\^\d{8}-r\.3$/);

    const post = await run("postdeploy");
    assert.equal(post.exitCode, 0, post.stderr);
  });

  await t.test("config file: options come from .skewcacherc.json", async () => {
    const rc = path.join(proj, ".skewcacherc.json");
    fs.writeFileSync(rc, JSON.stringify({ bucket: "skewcache-rc", maxAge: "P3D", bogus: 1 }));
    makeBuild(4);

    const pre = await run("predeploy", "--verbose");
    assert.equal(pre.exitCode, 0, pre.stderr);
    assert.match(pre.stdout, /skewcache-rc\/skewcache-itest\.zip/, "bucket read from rc");
    assert.match(pre.stderr, /starting with empty skewcache/, "rc bucket has no cache yet");
    assert.match(pre.stderr, /ignoring unknown key "bogus"/);
    fs.rmSync(path.join(proj, ".deploytmp"), { recursive: true, force: true });

    // CLI flags win over the config file: the default bucket has r.1–r.3.
    const pre2 = await run("predeploy", "--verbose", "--bucket", "skewcache");
    assert.equal(pre2.exitCode, 0, pre2.stderr);
    assert.match(pre2.stdout, /skewcache\/skewcache-itest\.zip/, "--bucket overrides rc");
    assert.match(pre2.stdout, /restoring \^\d{8}-r\.3 -> dist\/r\.3/);
    fs.rmSync(path.join(proj, ".deploytmp"), { recursive: true, force: true });
    fs.rmSync(rc);
  });

  await t.test("custom revision formats via --revision-pattern", async () => {
    const makeVersionBuild = (v: string) => {
      fs.rmSync(path.join(proj, "dist"), { recursive: true, force: true });
      fs.mkdirSync(path.join(proj, "dist", v), { recursive: true });
      fs.writeFileSync(path.join(proj, "dist", v, "app.js"), `asset-${v}\n`);
    };
    const args = ["--revision-pattern", "^v\\d+\\.\\d+\\.\\d+$", "--name", "itest-generic"];

    makeVersionBuild("v1.2.3");
    const pre = await run("predeploy", ...args);
    assert.equal(pre.exitCode, 0, pre.stderr);
    const post = await run("postdeploy", ...args);
    assert.equal(post.exitCode, 0, post.stderr);

    makeVersionBuild("v1.3.0");
    const pre2 = await run("predeploy", "--verbose", ...args);
    assert.equal(pre2.exitCode, 0, pre2.stderr);
    assert.match(pre2.stdout, /restoring \^\d{8}-v1\.2\.3 -> dist\/v1\.2\.3/);
    assert.equal(
      fs.readFileSync(path.join(proj, "dist", "v1.2.3", "app.js"), "utf8"),
      "asset-v1.2.3\n",
    );
    const post2 = await run("postdeploy", ...args);
    assert.equal(post2.exitCode, 0, post2.stderr);
  });

  await t.test("custom storage: a JS config can replace the R2 backend", async () => {
    const configFile = path.join(proj, "skewcache.config.mjs");
    fs.writeFileSync(
      configFile,
      `import fs from "node:fs";
import path from "node:path";

const remote = path.resolve("fake-remote.zip");
export default {
  name: "itest-storage",
  storage: () => ({
    description: \`local file \${remote}\`,
    async get(file) {
      if (!fs.existsSync(remote)) return false;
      fs.copyFileSync(remote, file);
      return true;
    },
    async put(file) {
      fs.copyFileSync(file, remote);
    },
  }),
};
`,
    );
    t.after(() => fs.rmSync(configFile, { force: true }));

    makeBuild(5);
    const pre = await run("predeploy", "--verbose");
    assert.equal(pre.exitCode, 0, pre.stderr);
    assert.match(pre.stdout, /Fetching skewcache from local file/, "custom storage in use");
    assert.match(pre.stderr, /starting with empty skewcache/);
    const post = await run("postdeploy");
    assert.equal(post.exitCode, 0, post.stderr);
    assert.ok(fs.existsSync(path.join(proj, "fake-remote.zip")), "archive put via custom storage");

    makeBuild(6);
    const pre2 = await run("predeploy", "--verbose");
    assert.equal(pre2.exitCode, 0, pre2.stderr);
    assert.match(pre2.stdout, /restoring \^\d{8}-r\.5 -> dist\/r\.5/, "r.5 fetched via custom storage");
    const post2 = await run("postdeploy");
    assert.equal(post2.exitCode, 0, post2.stderr);
  });
});
