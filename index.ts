// Package entry point declaring types for config files.

// A subset of Temporal.DurationLike so consumers don't need native Temporal.
export interface DurationLike {
  years?: number;
  months?: number;
  weeks?: number;
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
  microseconds?: number;
  nanoseconds?: number;
}

// Storage abstraction for the skewcache archive. The default implementation
// keeps the archive in a Cloudflare R2 bucket via wrangler. A JS config file
// may supply a custom storage factory.
export interface Storage {
  // Human-readable location of the archive, used in log messages.
  readonly description: string;

  // Download the cache archive into the local file at `file`. Returns false
  // if no archive exists in storage yet; throws if storage is unusable (bad
  // credentials, missing tooling).
  get(file: string): Promise<boolean>;

  // Upload the local file at `file` as the new cache archive.
  put(file: string): Promise<void>;
}

// The effective config, after CLI flags, the config file, and the built-in
// defaults have been merged. This is what a storage factory receives.
export interface ResolvedConfig {
  name: string; // the R2 object key is <name>
  bucket: string;
  dist: string; // build output directory
  tmp: string; // temp working directory
  maxAge: DurationLike; // prune cache entries older than this
  assetDir: RegExp; // matches the revision directory name in dist
  local: boolean; // use wrangler's local simulated R2
  remotePath: string; // <bucket>/<name>
  cacheDir: string; // <tmp>/skewcache
  archive: string; // <tmp>/skewcache.zip
}

// Builds a Storage implementation from the resolved config.
export type StorageFactory = (cfg: ResolvedConfig) => Storage;

// What a config file may contain. Every key is optional; anything omitted
// falls back to a command-line flag, then to the built-in default.
export interface UserConfig {
  name?: string;
  bucket?: string;
  dist?: string;
  tmp?: string;

  // Prune cache entries older than this, except the newest one. Accepts a
  // Temporal.Duration, a duration-like object such as `{ days: 7 }`, or an
  // ISO 8601 duration string such as "P7D". Mutually exclusive with
  // `maxAgeDays`; supplying both is an error.
  maxAge?: DurationLike | string;
  maxAgeDays?: number;

  // Matches the revision directory name in dist. A string is compiled with
  // `new RegExp`.
  assetDir?: string | RegExp;

  local?: boolean;

  // Replaces the default R2 storage backend. Functions can only come from a
  // JS or TS config file, not from JSON or YAML.
  storage?: StorageFactory;
}

// Identity function that types a config file without a type annotation.
// Equivalent to `satisfies UserConfig`, and usable from a .js config.
export function defineConfig(config: UserConfig): UserConfig {
  return config;
}
