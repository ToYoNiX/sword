import { isAbsolute, resolve } from 'node:path';

/** Everything the CLI touches outside the vault, so tests can run it in-process. */
export interface Io {
  /** The current folder; only asked for when a command needs it, since it may no longer exist. */
  cwd: () => string;
  now: () => string;
  /** An environment variable, e.g. SWORD_CALDAV_PASSWORD. */
  env: (name: string) => string | undefined;
  out: (text: string) => void;
  err: (text: string) => void;
  color: boolean;
}

/** A failure to report and exit with: 1 for problems, 2 for wrong usage. */
export class CliError extends Error {
  readonly code: number;

  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

/** A path from the command line; only a relative one needs the current folder. */
export function resolvePath(io: Io, path: string): string {
  return isAbsolute(path) ? path : resolve(io.cwd(), path);
}

const CODES = { bold: 1, dim: 2, red: 31, yellow: 33, green: 32 } as const;

export function paint(io: Io, style: keyof typeof CODES, text: string): string {
  return io.color ? `\x1b[${CODES[style]}m${text}\x1b[0m` : text;
}
