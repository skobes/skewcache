import fs from "node:fs";
import path from "node:path";
import { createZip, extractZip } from "./archive.ts";
import { type Config, ENTRY_RE } from "./config.ts";
import { die, info, warn } from "./logging.ts";
import { restoreRecentRevisions } from "./restore.ts";

export async function predeploy(cfg: Config): Promise<void> {
  // Locate the fresh build revision before restoring cached revisions makes
  // the dist directory ambiguous.
  const rev = findRevision(cfg);
  makeTmpDir(cfg);
  await fetchCache(cfg);
  // Restore before saving: restore discards any cache entry whose dist
  // directory already exists, which would delete the fresh entry.
  restoreRecentRevisions(cfg);
  saveRevision(cfg, rev);
}

function findRevision(cfg: Config): string {
  info("Locating build revision");
  if (!fs.existsSync(cfg.dist)) {
    die(`build output directory ${cfg.dist}/ does not exist`);
  }
  const revs = fs
    .readdirSync(cfg.dist, { withFileTypes: true })
    .filter((e) => e.isDirectory() && cfg.assetDir.test(e.name))
    .map((e) => e.name);

  if (revs.length === 0) {
    die(`no directory matching ${cfg.assetDir} found in ${cfg.dist}/`);
  } else if (revs.length > 1) {
    die(`multiple revision directories found in ${cfg.dist}/ (${revs.join(", ")})`);
  }
  info(`found ${revs[0]}`);
  return revs[0];
}

function makeTmpDir(cfg: Config): void {
  info(`Creating ${cfg.tmp}`);
  if (fs.existsSync(cfg.tmp)) {
    warn(
      `${cfg.tmp} already exists (leftover from a previous failed deploy?); ` +
        `removing`,
    );
    fs.rmSync(cfg.tmp, { recursive: true, force: true });
  }
  fs.mkdirSync(cfg.cacheDir, { recursive: true });
}

async function fetchCache(cfg: Config): Promise<void> {
  info(`Fetching skewcache from ${cfg.storage.description}`);
  const fetched = await cfg.storage.get(cfg.archive);
  if (!fetched) {
    warn("no cache found in storage; starting with empty skewcache");
    fs.rmSync(cfg.archive, { force: true });
    return;
  }
  try {
    extractZip(cfg.archive, cfg.cacheDir);
  } catch (err) {
    die(`failed to extract ${cfg.archive}: ${err instanceof Error ? err.message : err}`);
  }
}

function saveRevision(cfg: Config, rev: string): void {
  const src = path.join(cfg.dist, rev);
  if (!fs.existsSync(src)) die(`${src} not found`);
  const today = Temporal.Now.plainDateISO().toString().replaceAll("-", "");
  // Entry naming ("^<YYYYMMDD>-<revdir>") is documented at ENTRY_RE in
  // config.ts, which parses these names back.
  const entryName = `^${today}-${rev}`;
  info(`Adding ${rev} to skewcache as ${entryName}`);
  // The fresh entry becomes the newest; demote whatever held the marker.
  for (const name of fs.readdirSync(cfg.cacheDir)) {
    if (!name.startsWith("^")) continue;
    const demoted = path.join(cfg.cacheDir, name.slice(1));
    fs.rmSync(demoted, { recursive: true, force: true });
    fs.renameSync(path.join(cfg.cacheDir, name), demoted);
  }
  const dest = path.join(cfg.cacheDir, entryName);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.rmSync(path.join(cfg.cacheDir, `${today}-${rev}`), { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

export async function postdeploy(cfg: Config): Promise<void> {
  if (!fs.existsSync(cfg.cacheDir)) {
    die(`${cfg.cacheDir} not found; run "skewcache predeploy" before deploying`);
  }
  await uploadCache(cfg);
  listCache(cfg);
  cleanup(cfg);
}

// Print the final cache contents, one entry per line as "<date> <name>", with
// the newest (marked) entry flagged. Goes to stdout regardless of verbosity.
function listCache(cfg: Config): void {
  const rows = fs
    .readdirSync(cfg.cacheDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ENTRY_RE.exec(e.name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(([, marker, date, name]) => ({ marker, date, name }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  console.log(`skewcache now holds ${rows.length} revision(s):`);
  for (const { marker, date, name } of rows) {
    console.log(`  ${date} ${name}${marker === "^" ? " (latest)" : ""}`);
  }
}

async function uploadCache(cfg: Config): Promise<void> {
  info(`Archiving and uploading skewcache to ${cfg.storage.description}`);
  try {
    createZip(cfg.cacheDir, cfg.archive);
  } catch (err) {
    die(`failed to create ${cfg.archive}: ${err instanceof Error ? err.message : err}`);
  }
  await cfg.storage
    .put(cfg.archive)
    .catch((err) => die(`failed to upload skewcache: ${err.message ?? err}`));
}

function cleanup(cfg: Config): void {
  info(`Cleaning up ${cfg.tmp}`);
  fs.rmSync(cfg.tmp, { recursive: true, force: true });
}
