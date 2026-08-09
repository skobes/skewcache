// assetDir helper for bundler configs like vite.config.ts

import { execFileSync } from "node:child_process";
import process from "node:process";

function git(args: string[], ifFailed?: string): string {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    // A spawn failure sets `code`; a non-zero exit sets `status` instead.
    const { code, stderr } = err as { code?: string; stderr?: string };
    if (code === "ENOENT") throw new Error(
        "assetDir: git is not installed, or is not on PATH");
    const detail = stderr?.trim() || (err as Error).message;
    throw new Error(`assetDir: ${ifFailed ?? `\`git ${args.join(" ")}\` failed`}: ${detail}`);
  }
}

function gitRevisionCount(): string {
  // Nonzero exit => no git repo.
  if (git(["rev-parse", "--is-shallow-repository"],
      `not a git repository: ${process.cwd()}`) === "true") {
    throw new Error("assetDir: the revision count is not usable in a shallow repository");
  }
  const count = git(["rev-list", "--count", "HEAD"]);
  if (git(["status", "--porcelain", "-uno"]) !== "") {
    console.warn(
        `assetDir: warning: the working tree has uncommitted changes, so ` +
        `revision ${count} does not identify what was built`);
  }
  return count;
}

let revision: string | undefined;

// Generates a name for the asset dir based on git revision count e.g. "r.123"
export function assetDir(template: string = "r.{rev}"): string {
  revision ??= gitRevisionCount();
  return template.replaceAll("{rev}", revision);
}
