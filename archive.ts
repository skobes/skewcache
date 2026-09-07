import fs from "node:fs";
import path from "node:path";
import { zipSync, unzipSync, type Zippable } from "fflate";

// Create a zip archive at `file` from the files under `dir`, keyed by
// POSIX-style path relative to `dir`. Empty directories are not preserved.
export function createZip(dir: string, file: string): void {
  const files: Zippable = {};
  for (const name of fs.readdirSync(dir, { recursive: true }) as string[]) {
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) continue;
    files[name.split(path.sep).join("/")] = fs.readFileSync(abs);
  }
  fs.writeFileSync(file, zipSync(files));
}

// Extract the zip archive at `file` into `dir`, creating it if needed.
export function extractZip(file: string, dir: string): void {
  const root = path.resolve(dir);
  const entries = unzipSync(fs.readFileSync(file));
  for (const [name, data] of Object.entries(entries)) {
    // Ignore directory entries.
    if (name.endsWith("/")) continue;
    const dest = path.resolve(root, name);
    // Precaution: reject anything that would escape `dir`
    if (dest !== root && !dest.startsWith(root + path.sep)) {
      throw new Error(`archive entry escapes ${dir}: ${name}`);
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
}
