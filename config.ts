import fs from "node:fs";
import path from "node:path";
import { cosmiconfig } from "cosmiconfig";
import { die, logger } from "./logging.ts";
import { r2Storage } from "./r2-storage.ts";

// Cache entries are named "<YYYYMMDD>-<revdir>", where <revdir> is the
// revision directory's name in dist, verbatim. A leading "^" marks the
// newest entry for internal bookkeeping.
export const ENTRY_RE = /^(\^?)(\d{8})-(.+)$/;

// Storage abstraction for the skewcache archive. The default implementation
// (r2-storage.ts) keeps the archive in a Cloudflare R2 bucket via wrangler.
// A JS config file may supply a custom storage factory.
export interface Storage {
  // Human-readable location of the archive, used in log messages.
  readonly description: string;

  // Download the cache archive into the local file at `file`. Returns false
  // if no archive exists in storage yet.
  get(file: string): Promise<boolean>;

  // Upload the local file at `file` as the new cache archive.
  put(file: string): Promise<void>;
}

// Deploy settings, resolved from CLI flags, then the config file, then
// built-in defaults.
interface Settings {
  name: string; // the R2 object key is <name>.zip
  bucket: string;
  dist: string;
  tmp: string;
  maxAge: Temporal.Duration; // prune cache entries older than this
  assetDir: RegExp; // matches the revision directory name in dist
  local: boolean; // use wrangler's local simulated R2
}

// Builds a Storage implementation from the resolved config. A JS config
// file may supply one under the "storage" key to replace the default R2
// implementation (r2-storage.ts).
export type StorageFactory = (cfg: Omit<Config, "storage">) => Storage;

// A config file may supply any subset of the settings, plus a storage
// factory (JS configs only; JSON/YAML cannot express functions).
type FileConfig = Partial<Settings> & { storage?: StorageFactory };

// The config-related command-line options, as parsed by main.ts.
export interface CliOptions {
  name?: string;
  bucket?: string;
  dist?: string;
  tmp?: string;
  "max-age-days"?: string;
  "asset-dir"?: string;
  local?: boolean;
  config?: string;
}

export interface Config extends Settings {
  remotePath: string; // <bucket>/<name>.zip
  cacheDir: string; // <tmp>/skewcache
  archive: string; // <tmp>/skewcache.zip
  storage: Storage; // where the cache archive lives (R2 by default)
}

function readPackageName(): string {
  let pkg: unknown;
  try {
    pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  } catch {
    die("could not read ./package.json (or pass --name)");
  }
  const name = (pkg as { name?: unknown }).name;
  if (typeof name !== "string" || name === "") {
    die("could not read package name from package.json");
  }
  return name;
}

function validateFileConfig(raw: unknown, source: string): FileConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    die(`invalid config in ${source}: expected an object`);
  }
  if ("maxAge" in raw && "maxAgeDays" in raw) {
    die(`invalid config in ${source}: specify only one of "maxAge" and "maxAgeDays"`);
  }
  const out: FileConfig = {};
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case "name":
      case "bucket":
      case "dist":
      case "tmp":
        if (typeof value !== "string" || value === "") {
          die(`invalid "${key}" in ${source}: expected a non-empty string`);
        }
        out[key] = value;
        break;
      case "maxAgeDays":
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
          die(`invalid "maxAgeDays" in ${source}: expected a non-negative integer`);
        }
        out.maxAge = Temporal.Duration.from({ days: value });
        break;
      case "maxAge": {
        let maxAge: Temporal.Duration;
        try {
          maxAge = Temporal.Duration.from(
            value as Temporal.Duration | Temporal.DurationLike | string,
          );
        } catch {
          die(
            `invalid "maxAge" in ${source}: expected a Temporal.Duration, ` +
              `duration-like object, or ISO 8601 duration string`,
          );
        }
        if (maxAge.sign < 0) die(`invalid "maxAge" in ${source}: must not be negative`);
        out.maxAge = maxAge;
        break;
      }
      case "assetDir": {
        if (value instanceof RegExp) {
          out.assetDir = value;
          break;
        }
        if (typeof value !== "string" || value === "") {
          die(`invalid "assetDir" in ${source}: expected a non-empty string or RegExp`);
        }
        try {
          out.assetDir = new RegExp(value);
        } catch {
          die(`invalid "assetDir" in ${source}: not a valid regular expression`);
        }
        break;
      }
      case "local":
        if (typeof value !== "boolean") {
          die(`invalid "local" in ${source}: expected a boolean`);
        }
        out.local = value;
        break;
      case "storage":
        if (typeof value !== "function") {
          die(
            `invalid "storage" in ${source}: expected a function returning a ` +
              `Storage implementation (only possible from a JS config file)`,
          );
        }
        out.storage = value as StorageFactory;
        break;
      default:
        logger.warn(`ignoring unknown key "${key}" in ${source}`);
    }
  }
  return out;
}

async function loadFileConfig(configPath: string | undefined): Promise<FileConfig> {
  let result;
  try {
    // Note: cosmiconfig eagerly parses package.json.
    const explorer = cosmiconfig("skewcache");
    result = configPath ? await explorer.load(configPath) : await explorer.search();
  } catch (err) {
    die(`failed to load config: ${err instanceof Error ? err.message : err}`);
  }
  if (!result || result.isEmpty || result.config == null) return {};
  return validateFileConfig(result.config, result.filepath);
}

// Resolve the effective config: CLI flags take precedence over the config
// file, which takes precedence over the built-in defaults.
export async function resolveConfig(cli: CliOptions): Promise<Config> {
  const fileCfg = await loadFileConfig(cli.config);

  let maxAge: Temporal.Duration;
  if (cli["max-age-days"] !== undefined) {
    const days = Number(cli["max-age-days"]);
    if (!Number.isInteger(days) || days < 0) {
      die(`invalid --max-age-days: ${cli["max-age-days"]}`);
    }
    maxAge = Temporal.Duration.from({ days });
  } else {
    maxAge = fileCfg.maxAge ?? Temporal.Duration.from({ days: 7 });
  }

  let assetDir: RegExp;
  if (cli["asset-dir"] !== undefined) {
    try {
      assetDir = new RegExp(cli["asset-dir"]);
    } catch {
      die(`invalid --asset-dir: not a valid regular expression`);
    }
  } else {
    assetDir = fileCfg.assetDir ?? /^r\.\d+$/;
  }

  const settings: Settings = {
    name: cli.name ?? fileCfg.name ?? readPackageName(),
    bucket: cli.bucket ?? fileCfg.bucket ?? "skewcache",
    dist: cli.dist ?? fileCfg.dist ?? "dist",
    tmp: cli.tmp ?? fileCfg.tmp ?? ".deploytmp",
    maxAge,
    assetDir,
    local: cli.local ?? fileCfg.local ?? false,
  };
  const base: Omit<Config, "storage"> = {
    ...settings,
    remotePath: `${settings.bucket}/${settings.name}.zip`,
    cacheDir: path.join(settings.tmp, "skewcache"),
    archive: path.join(settings.tmp, "skewcache.zip"),
  };
  return { ...base, storage: (fileCfg.storage ?? r2Storage)(base) };
}
