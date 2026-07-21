import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { resolveConfig } from "./config.ts";
import { FatalError } from "./logging.ts";

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

test("defaults: package name, built-in settings, derived paths", async () => {
  const cfg = await resolveConfig({});
  assert.equal(cfg.name, "unit-app");
  assert.equal(cfg.bucket, "skewcache");
  assert.equal(cfg.dist, "dist");
  assert.equal(cfg.tmp, ".deploytmp");
  assert.equal(cfg.local, false);
  assert.equal(cfg.maxAge.total("days"), 7);
  assert.match("r.42", cfg.assetDir);
  assert.doesNotMatch("v1.2.3", cfg.assetDir);
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
    "asset-dir": "^v\\d+$",
    local: true,
  });
  assert.equal(cfg.name, "other");
  assert.equal(cfg.bucket, "b");
  assert.equal(cfg.dist, "out");
  assert.equal(cfg.tmp, "t");
  assert.equal(cfg.maxAge.total("days"), 3);
  assert.match("v7", cfg.assetDir);
  assert.doesNotMatch("r.7", cfg.assetDir);
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

test("JS config assetDir accepts a string or a RegExp", async () => {
  const rc = path.join(workDir, "rc-regexp.mjs");
  fs.writeFileSync(rc, "export default { assetDir: /^v\\d+$/ };\n");
  let cfg = await resolveConfig({ config: rc });
  assert.match("v7", cfg.assetDir);
  assert.doesNotMatch("r.7", cfg.assetDir);
  fs.writeFileSync(rc, 'export default { assetDir: "^v\\\\d+$" };\n');
  cfg = await resolveConfig({ config: rc });
  assert.match("v7", cfg.assetDir);
});

test("invalid --max-age-days dies", async () => {
  await assert.rejects(resolveConfig({ "max-age-days": "nope" }), FatalError);
  await assert.rejects(resolveConfig({ "max-age-days": "-1" }), FatalError);
});

test("invalid --asset-dir dies", async () => {
  await assert.rejects(resolveConfig({ "asset-dir": "(" }), FatalError);
});

test("config file rejects bad values", async () => {
  const rc = path.join(workDir, "rc-bad.json");
  const cases = [
    { maxAge: "P3D", maxAgeDays: 3 }, // both forms at once
    { maxAge: "-P1D" }, // negative duration
    { maxAgeDays: 1.5 }, // non-integer
    { bucket: "" }, // empty string
    { assetDir: "(" }, // bad regex
    { local: "yes" }, // wrong type
  ];
  for (const bad of cases) {
    fs.writeFileSync(rc, JSON.stringify(bad));
    await assert.rejects(resolveConfig({ config: rc }), FatalError, JSON.stringify(bad));
  }
});

test("missing package.json (and no --name) dies", async (t) => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "skewcache-utest-bare-"));
  t.after(() => {
    process.chdir(workDir);
    fs.rmSync(bare, { recursive: true, force: true });
  });
  process.chdir(bare);
  await assert.rejects(resolveConfig({}), FatalError);
  // With --name, package.json is never consulted.
  const cfg = await resolveConfig({ name: "explicit" });
  assert.equal(cfg.name, "explicit");
  // An unparseable package.json dies cleanly (cosmiconfig also reads it for
  // its meta-config, which must not leak a raw JSONError).
  fs.writeFileSync(path.join(bare, "package.json"), "not json\n");
  await assert.rejects(resolveConfig({ name: "explicit" }), FatalError);
});

test("maxAge boundary: zero days is allowed", async () => {
  const cfg = await resolveConfig({ "max-age-days": "0" });
  assert.equal(cfg.maxAge.total("days"), 0);
});
