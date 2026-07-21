import process from "node:process";
import spawn, { type Options } from "nano-spawn";
import type { StorageFactory } from "./config.ts";
import { die, isVerbose, logger } from "./logging.ts";

// Run wrangler from the project's node_modules/.bin (preferLocal), falling
// back to PATH. In verbose mode its output streams to the terminal;
// otherwise it is captured, and fatal-error handlers replay it as needed.
function wrangler(...args: string[]) {
  const opts: Options = isVerbose() ? { preferLocal: true, stdio: "inherit" } : { preferLocal: true };
  return spawn("wrangler", args, opts);
}

export const r2Storage: StorageFactory = (cfg) => {
  const remoteFlag = cfg.local ? [] : ["--remote"];
  return {
    description: `r2 (${cfg.remotePath})`,

    get: async (file) => {
      if (!cfg.local) {
        // Confirm wrangler runs and the user is authenticated.
        await wrangler("whoami", "--json").catch((err) => {
          if (err.stderr) process.stderr.write(err.stderr + "\n");
          die(
            `wrangler whoami failed; is wrangler installed and are you ` +
              `logged in? (try \`npx wrangler login\`)`,
          );
        });
        // Create bucket if it doesn't exist yet.
        await wrangler("r2", "bucket", "info", cfg.bucket).catch(async () => {
          logger.warn(`R2 bucket ${cfg.bucket} does not exist; creating it`);
          await wrangler("r2", "bucket", "create", cfg.bucket).catch((err) => {
            if (err.stderr) process.stderr.write(err.stderr + "\n");
            die(`wrangler r2 bucket create ${cfg.bucket} failed`);
          });
        });
      }
      try {
        await wrangler("r2", "object", "get", cfg.remotePath, ...remoteFlag, `--file=${file}`);
        return true;
      } catch {
        return false;
      }
    },

    put: async (file) => {
      await wrangler("r2", "object", "put", cfg.remotePath, ...remoteFlag, `--file=${file}`).catch(
        (err) => {
          if (err.stderr) process.stderr.write(err.stderr + "\n");
          throw new Error(`wrangler r2 object put ${cfg.remotePath} failed`);
        },
      );
    },
  };
};
