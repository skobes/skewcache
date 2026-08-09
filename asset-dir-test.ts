import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import type { assetDir as AssetDir } from "./asset-dir.ts";

let workDir: string;
let repo: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

function commit(cwd: string, msg: string): void {
  const identity = ["-c", "user.name=t", "-c", "user.email=t@example.com"];
  git(cwd, ...identity, "commit", "-q", "--allow-empty", "-m", msg);
}

// assetDir() memoizes the revision count, so tests that need it recomputed
// load a fresh copy of the module. A query string makes the ESM loader treat
// each one as a distinct module.
let loads = 0;
async function load(): Promise<typeof AssetDir> {
  const mod = (await import(`./asset-dir.ts?${loads++}`)) as { assetDir: typeof AssetDir };
  return mod.assetDir;
}

// assetDir() reads the current directory, which is the project root when a
// bundler loads its config file.
function inDir<T>(dir: string, fn: () => T): T {
  const prev = process.cwd();
  process.chdir(dir);
  try {
    return fn();
  } finally {
    process.chdir(prev);
  }
}

// Collects anything the code under test writes to console.warn.
function captureWarnings(fn: () => unknown): string[] {
  const warnings: string[] = [];
  const prev = console.warn;
  console.warn = (msg: string) => void warnings.push(msg);
  try {
    fn();
  } finally {
    console.warn = prev;
  }
  return warnings;
}

before(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "skewcache-assetdir-"));
  repo = path.join(workDir, "repo");
  fs.mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  for (const n of [1, 2, 3]) commit(repo, `c${n}`);
});
after(() => {
  process.chdir(os.tmpdir());
  fs.rmSync(workDir, { recursive: true, force: true });
});

test("substitutes the revision count, and counts it once", async () => {
  const assetDir = await load();
  assert.equal(inDir(repo, () => assetDir()), "r.3");
  assert.equal(inDir(repo, () => assetDir("v{rev}-assets")), "v3-assets");
  commit(repo, "c4");
  assert.equal(inDir(repo, () => assetDir()), "r.3"); // memoized
  assert.equal(inDir(repo, () => assetDir()), "r.3");
  assert.equal(
    await load().then((fresh) => inDir(repo, () => fresh())),
    "r.4",
  );
});

test("warns only when the working tree is dirty", async () => {
  const dirty = path.join(workDir, "dirty");
  fs.mkdirSync(dirty);
  git(dirty, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dirty, "tracked.txt"), "one\n");
  git(dirty, "add", "tracked.txt");
  commit(dirty, "c1");

  const clean = await load();
  assert.deepEqual(
    captureWarnings(() => inDir(dirty, clean)),
    [],
  );

  fs.writeFileSync(path.join(dirty, "tracked.txt"), "two\n");
  const modified = await load();
  const warnings = captureWarnings(() => inDir(dirty, modified));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /uncommitted changes, so revision 1 does not identify/);
});

test("rejects a shallow repository", async () => {
  const shallow = path.join(workDir, "shallow");
  execFileSync("git", ["clone", "-q", "--depth", "1", `file://${repo}`, shallow], {
    stdio: "ignore",
  });
  const assetDir = await load();
  assert.throws(() => inDir(shallow, assetDir), /shallow repository/);
});

test("reports a missing repository and a missing git", async () => {
  const notARepo = path.join(workDir, "empty");
  fs.mkdirSync(notARepo);
  const assetDir = await load();
  const notARepoRe = /assetDir: not a git repository: .*empty: fatal:/;
  assert.throws(() => inDir(notARepo, assetDir), notARepoRe);

  const prev = process.env.PATH;
  process.env.PATH = path.join(workDir, "no-such-bin");
  try {
    assert.throws(() => inDir(repo, assetDir), /assetDir: git is not installed/);
  } finally {
    process.env.PATH = prev;
  }
});
