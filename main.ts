#!/usr/bin/env -S node --harmony-temporal

import { parseArgs } from "node:util";
import process from "node:process";
import { resolveConfig } from "./config.ts";
import { die, error, FatalError, setVerbose } from "./logging.ts";
import { predeploy, postdeploy } from "./skewcache.ts";

const USAGE = `usage: skewcache <predeploy|postdeploy> [options]

commands:
  predeploy              fetch cache and mix into dist
  postdeploy             upload new cache

options:
  --name <name>          project name; the R2 object key is <name>.zip
                         (default: the "name" field of ./package.json)
  --bucket <bucket>      R2 bucket holding the cache (default: skewcache)
  --dist <dir>           build output directory (default: dist)
  --tmp <dir>            temp working directory (default: .deploytmp)
  --max-age-days <n>     prune cache entries older than this, except the
                         newest one (default: 7)
  --asset-dir <re>       regex matching the revision directory name inside
                         the dist directory (default: ^r\\.\\d+$)
  --local                use wrangler's local simulated R2 instead of the
                         real remote bucket (mainly for testing)
  --config <path>        read options from this config file instead of
                         searching the current directory
  -v, --verbose          show progress steps and stream wrangler output
                         (default: warnings and errors only)
  -h, --help             show this help

configuration file:
  Options may also be set in skewcache.config.js:
  {
    name: string,
    bucket: string,
    dist: string,
    tmp: string,
    maxAge: Temporal.Duration,
    assetDir: RegExp,
    local: boolean,
    storage: cfg => {
      description: string,
      get: (file: string) => Promise<boolean>,
      put: (file: string) => Promise<void>
    }
  }
  Command-line flags take precedence over the config file.
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      // Options without a default here may be supplied by the config file;
      // the built-in default applies only when neither source sets them.
      name: { type: "string" },
      bucket: { type: "string" },
      dist: { type: "string" },
      tmp: { type: "string" },
      "max-age-days": { type: "string" },
      "asset-dir": { type: "string" },
      local: { type: "boolean" },
      config: { type: "string" },
      verbose: { type: "boolean", short: "v", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }
  setVerbose(values.verbose);
  if (positionals.length === 0) {
    process.stderr.write(USAGE.split("\n")[0] + "\n");
    process.exit(1);
  }
  if (positionals.length !== 1) die(`expected exactly one command\n\n${USAGE}`);
  const command = positionals[0];

  const cfg = await resolveConfig(values);

  switch (command) {
    case "predeploy":
      await predeploy(cfg);
      break;
    case "postdeploy":
      await postdeploy(cfg);
      break;
    default:
      die(`unknown command "${command}"\n\n${USAGE}`);
  }
}

try {
  await main();
} catch (err) {
  if (err instanceof FatalError) {
    error(err.message);
    process.exit(1);
  }
  throw err;
}
