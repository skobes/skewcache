import fs from "node:fs";
import path from "node:path";
import { zipSync, unzipSync, type Zippable } from "fflate";

// Recursively collect a directory's files, keyed by POSIX-style path relative
// to `dir`. Directory entries (keys ending in "/") are included so empty
// directories survive a round trip, matching `tar`'s behavior.
function collect(dir: string, base: string, out: Zippable): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      out[`${rel}/`] = new Uint8Array();
      collect(abs, rel, out);
    } else {
      out[rel] = fs.readFileSync(abs);
    }
  }
}

// Create a zip archive at `file` from the contents of `dir`.
export function createZip(dir: string, file: string): void {
  const files: Zippable = {};
  collect(dir, "", files);
  fs.writeFileSync(file, zipSync(files));
}

// Extract the zip archive at `file` into `dir`, creating it if needed.
export function extractZip(file: string, dir: string): void {
  const entries = unzipSync(fs.readFileSync(file));
  for (const [name, data] of Object.entries(entries)) {
    const dest = path.join(dir, name);
    if (name.endsWith("/")) {
      fs.mkdirSync(dest, { recursive: true });
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, data);
    }
  }
}
