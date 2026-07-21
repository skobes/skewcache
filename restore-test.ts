import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Config } from "./config.ts";
import { setSilent } from "./logging.ts";
import { restoreRecentRevisions } from "./restore.ts";

setSilent(); // silence expected warnings

const today = Temporal.Now.plainDateISO();
const stamp = (d: Temporal.PlainDate) => d.toString().replaceAll("-", "");
const fresh = stamp(today);
const stale = stamp(today.subtract({ days: 8 })); // past the 7-day default

let root: string;
let cfg: Config;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "skewcache-rtest-"));
  cfg = {
    dist: path.join(root, "dist"),
    cacheDir: path.join(root, "cache"),
    maxAge: Temporal.Duration.from({ days: 7 }),
  } as Config;
  fs.mkdirSync(cfg.dist);
  fs.mkdirSync(cfg.cacheDir);
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function addEntry(name: string): void {
  const dir = path.join(cfg.cacheDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "app.js"), `${name}\n`);
}
const cacheNames = () => fs.readdirSync(cfg.cacheDir).sort();
const distNames = () => fs.readdirSync(cfg.dist).sort();

test("restores fresh entries into dist", () => {
  addEntry(`${fresh}-r.1`);
  addEntry(`^${fresh}-r.2`);
  restoreRecentRevisions(cfg);
  assert.deepEqual(distNames(), ["r.1", "r.2"]);
  assert.equal(
    fs.readFileSync(path.join(cfg.dist, "r.2", "app.js"), "utf8"),
    `^${fresh}-r.2\n`,
  );
  // Restore copies; the cache entries remain for the next upload.
  assert.deepEqual(cacheNames(), [`${fresh}-r.1`, `^${fresh}-r.2`]);
});

test("deletes stale entries instead of restoring them", () => {
  addEntry(`${stale}-r.1`);
  addEntry(`^${fresh}-r.2`);
  restoreRecentRevisions(cfg);
  assert.deepEqual(distNames(), ["r.2"]);
  assert.deepEqual(cacheNames(), [`^${fresh}-r.2`]);
});

test("an entry dated exactly at the cutoff is stale", () => {
  addEntry(`${stamp(today.subtract(cfg.maxAge))}-r.1`);
  addEntry(`^${fresh}-r.2`);
  restoreRecentRevisions(cfg);
  assert.deepEqual(distNames(), ["r.2"]);
});

test("the ^-marked newest entry survives regardless of age", () => {
  addEntry(`^${stale}-r.1`);
  restoreRecentRevisions(cfg);
  assert.deepEqual(distNames(), ["r.1"]);
  assert.deepEqual(cacheNames(), [`^${stale}-r.1`]);
});

test("discards a cache entry whose dist directory already exists", () => {
  addEntry(`^${fresh}-r.1`);
  fs.mkdirSync(path.join(cfg.dist, "r.1"));
  fs.writeFileSync(path.join(cfg.dist, "r.1", "app.js"), "fresh build\n");
  restoreRecentRevisions(cfg);
  assert.equal(
    fs.readFileSync(path.join(cfg.dist, "r.1", "app.js"), "utf8"),
    "fresh build\n",
    "existing dist content is untouched",
  );
  assert.deepEqual(cacheNames(), [], "conflicting entry removed from cache");
});

test("ignores entries that don't match the naming scheme", () => {
  addEntry("README-not-an-entry"); // fails the name regex
  addEntry("20261399-r.1"); // matches the regex, but month 13 is not a date
  addEntry(`^${fresh}-r.2`);
  restoreRecentRevisions(cfg);
  assert.deepEqual(distNames(), ["r.2"]);
  // Unrecognized entries are left alone, not deleted.
  assert.ok(cacheNames().includes("README-not-an-entry"));
});
