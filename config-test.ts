/**
 * Unit tests for config resolution (config.ts). Runs in-process against a
 * temp working directory; die()'s process.exit is mocked to throw so error
 * paths can be asserted without killing the test runner.
 *
 * Run with: npm test (or node --test config-test.ts)
 */

import { test, before, after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { resolveConfig } from "./config.ts";
import { logger } from "./logging.ts";

// die() logs before exiting; silence it so expected failures don't clutter
// the test output.
logger.setLevel("SILENT");

let workDir: string;
before(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "skewcache-utest-"));
  fs.writeFileSync(path.join(workDir, "package.json"), '{ "name": "unit-app" }\n');
  process.chdir(workDir);
});
after(() => {
  process.chdir(os.tmpdir());
  fs.rmSync(workDir, { recursive: true, force: true });
});

// die() calls process.exit(1); turn that into a throw so the config
// functions reject instead of terminating the test process.
function mockExit(t: TestContext): void {
  t.mock.method(
    process,
    "exit",
    ((code?: number) => {
      throw new Error(`exit(${code})`);
    }) as unknown as typeof process.exit,
  );
}
const exits = /exit\(1\)/;

test("defaults: package name, built-in settings, derived paths", async () => {
  const cfg = await resolveConfig({});
  assert.equal(cfg.name, "unit-app");
  assert.equal(cfg.bucket, "skewcache");
  assert.equal(cfg.dist, "dist");
  assert.equal(cfg.tmp, ".deploytmp");
  assert.equal(cfg.local, false);
  assert.equal(cfg.maxAge.total("days"), 7);
  assert.match("r.42", cfg.revisionPattern);
  assert.doesNotMatch("v1.2.3", cfg.revisionPattern);
  assert.equal(cfg.remotePath, "skewcache/unit-app.zip");
  assert.equal(cfg.cacheDir, path.join(".deploytmp", "skewcache"));
  assert.equal(cfg.archive, path.join(".deploytmp", "skewcache.zip"));
  assert.equal(cfg.storage.description, "r2 (skewcache/unit-app.zip)");
});

test("CLI flags override the defaults", async () => {
  const cfg = await resolveConfig({
    name: "other",
    bucket: "b",
    dist: "out",
    tmp: "t",
    "max-age-days": "3",
    "revision-pattern": "^v\\d+$",
    local: true,
  });
  assert.equal(cfg.name, "other");
  assert.equal(cfg.bucket, "b");
  assert.equal(cfg.dist, "out");
  assert.equal(cfg.tmp, "t");
  assert.equal(cfg.maxAge.total("days"), 3);
  assert.match("v7", cfg.revisionPattern);
  assert.doesNotMatch("r.7", cfg.revisionPattern);
  assert.equal(cfg.local, true);
  assert.equal(cfg.remotePath, "b/other.zip");
});

test("config file supplies settings; CLI flags still win", async () => {
  const rc = path.join(workDir, "rc.json");
  fs.writeFileSync(
    rc,
    JSON.stringify({ name: "from-file", bucket: "file-bucket", maxAgeDays: 2 }),
  );
  const cfg = await resolveConfig({ config: rc, bucket: "cli-bucket" });
  assert.equal(cfg.name, "from-file");
  assert.equal(cfg.bucket, "cli-bucket");
  assert.equal(cfg.maxAge.total("days"), 2);
});

test("config file maxAge accepts an ISO 8601 duration string", async () => {
  const rc = path.join(workDir, "rc-iso.json");
  fs.writeFileSync(rc, JSON.stringify({ maxAge: "P3D" }));
  const cfg = await resolveConfig({ config: rc });
  assert.equal(cfg.maxAge.total("days"), 3);
});

test("JS config revisionPattern accepts a string or a RegExp", async () => {
  const rc = path.join(workDir, "rc-regexp.mjs");
  fs.writeFileSync(rc, "export default { revisionPattern: /^v\\d+$/ };\n");
  let cfg = await resolveConfig({ config: rc });
  assert.match("v7", cfg.revisionPattern);
  assert.doesNotMatch("r.7", cfg.revisionPattern);
  fs.writeFileSync(rc, 'export default { revisionPattern: "^v\\\\d+$" };\n');
  cfg = await resolveConfig({ config: rc });
  assert.match("v7", cfg.revisionPattern);
});

test("invalid --max-age-days dies", async (t) => {
  mockExit(t);
  await assert.rejects(resolveConfig({ "max-age-days": "nope" }), exits);
  await assert.rejects(resolveConfig({ "max-age-days": "-1" }), exits);
});

test("invalid --revision-pattern dies", async (t) => {
  mockExit(t);
  await assert.rejects(resolveConfig({ "revision-pattern": "(" }), exits);
});

test("config file rejects bad values", async (t) => {
  mockExit(t);
  const rc = path.join(workDir, "rc-bad.json");
  const cases = [
    { maxAge: "P3D", maxAgeDays: 3 }, // both forms at once
    { maxAge: "-P1D" }, // negative duration
    { maxAgeDays: 1.5 }, // non-integer
    { bucket: "" }, // empty string
    { revisionPattern: "(" }, // bad regex
    { local: "yes" }, // wrong type
  ];
  for (const bad of cases) {
    fs.writeFileSync(rc, JSON.stringify(bad));
    await assert.rejects(resolveConfig({ config: rc }), exits, JSON.stringify(bad));
  }
});

test("missing package.json (and no --name) dies", async (t) => {
  mockExit(t);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "skewcache-utest-bare-"));
  t.after(() => {
    process.chdir(workDir);
    fs.rmSync(bare, { recursive: true, force: true });
  });
  process.chdir(bare);
  await assert.rejects(resolveConfig({}), exits);
  // With --name, package.json is never consulted.
  const cfg = await resolveConfig({ name: "explicit" });
  assert.equal(cfg.name, "explicit");
  // An unparseable package.json dies cleanly (cosmiconfig also reads it for
  // its meta-config, which must not leak a raw JSONError).
  fs.writeFileSync(path.join(bare, "package.json"), "not json\n");
  await assert.rejects(resolveConfig({ name: "explicit" }), exits);
});

test("maxAge boundary: zero days is allowed", async () => {
  const cfg = await resolveConfig({ "max-age-days": "0" });
  assert.equal(cfg.maxAge.total("days"), 0);
});
