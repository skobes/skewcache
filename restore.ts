import fs from "node:fs";
import path from "node:path";
import { type Config, ENTRY_RE } from "./config.ts";
import { info, warn } from "./logging.ts";

// Prune stale cache entries and copy surviving revisions back to dist.
export function restoreRecentRevisions(cfg: Config): void {
  info(`Restoring recent skew revisions into ${cfg.dist}/`);
  // Entries at or before the cutoff date are stale.
  const cutoff = Temporal.Now.plainDateISO().subtract(cfg.maxAge);

  const entries = fs
    .readdirSync(cfg.cacheDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  // The newest entry carries a "^" marker and is preserved regardless of age.
  for (const name of entries) {
    const m = ENTRY_RE.exec(name);
    if (!m) {
      warn(`ignoring unexpected skewcache entry: ${name}`);
      continue;
    }
    const [, marker, dateStr, rev] = m;
    let entryDate: Temporal.PlainDate;
    try {
      entryDate = Temporal.PlainDate.from(dateStr);
    } catch {
      warn(`ignoring unexpected skewcache entry: ${name}`);
      continue;
    }
    const entryPath = path.join(cfg.cacheDir, name);
    const dest = path.join(cfg.dist, rev);
    const isNewest = marker === "^";

    if (Temporal.PlainDate.compare(entryDate, cutoff) <= 0 && !isNewest) {
      info(`deleting stale entry ${name}`);
      fs.rmSync(entryPath, { recursive: true });
    } else if (fs.existsSync(dest)) {
      warn(`${dest} already exists; discarding skewcache/${name}`);
      fs.rmSync(entryPath, { recursive: true });
    } else {
      info(`restoring ${name} -> ${dest}`);
      fs.cpSync(entryPath, dest, { recursive: true });
    }
  }
}
