import fs from "node:fs";
import path from "node:path";
import { zipSync, unzipSync, type Zippable } from "fflate";

export function createZip(dir: string, file: string): void {
  const files: Zippable = {};
  for (const entry of fs.readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isDirectory()) continue;
    const abs = path.join(entry.parentPath, entry.name);
    files[path.relative(dir, abs).split(path.sep).join("/")] =
      fs.readFileSync(abs);
  }
  fs.writeFileSync(file, zipSync(files));
}

export function extractZip(file: string, dir: string): void {
  const entries = unzipSync(fs.readFileSync(file));
  for (const [name, data] of Object.entries(entries)) {
    const dest = path.join(dir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
}
