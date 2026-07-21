import log from "loglevel";
import { red, yellow } from "yoctocolors";

// warn/error go to stderr via console; info/debug appear only under --verbose.
const logger = log.getLogger("skewcache");
logger.setLevel("WARN"); // warnings and errors only, until --verbose raises it

// Warnings and errors get a colored prefix; yoctocolors is a no-op when the
// terminal doesn't support color (NO_COLOR, etc).
export const warn = (msg: string): void => logger.warn(yellow("warning:"), msg);
export const error = (msg: string): void => logger.error(red("error:"), msg);
export const info = (msg: string): void => logger.info(msg);

export function setVerbose(v: boolean): void {
  logger.setLevel(v ? "INFO" : "WARN");
}

export function setSilent(): void {
  logger.setLevel("SILENT");
}

export function isVerbose(): boolean {
  return logger.getLevel() <= log.levels.INFO;
}

// Thrown by die(); main() catches it, reports the message, and exits 1.
// Nothing else may catch it, or a fatal error would be silently swallowed.
export class FatalError extends Error {}

export function die(msg: string): never {
  throw new FatalError(msg);
}
