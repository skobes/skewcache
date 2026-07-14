import process from "node:process";
import log from "loglevel";

// warn/error go to stderr via console; info/debug appear only under --verbose.
export const logger = log.getLogger("skewcache");
logger.setLevel("WARN"); // warnings and errors only, until --verbose raises it

// loglevel has no start()/progress level; alias it to info.
export const start = (...args: unknown[]): void => logger.info(...args);

export function setVerbose(v: boolean): void {
  logger.setLevel(v ? "INFO" : "WARN");
}

export function isVerbose(): boolean {
  return logger.getLevel() <= log.levels.INFO;
}

export function die(msg: string): never {
  logger.error(msg);
  process.exit(1);
}
