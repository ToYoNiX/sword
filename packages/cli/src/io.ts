/** Everything the CLI touches outside the vault, so tests can run it in-process. */
export interface Io {
  cwd: string;
  now: () => string;
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

const CODES = { bold: 1, dim: 2, red: 31, yellow: 33, green: 32 } as const;

export function paint(io: Io, style: keyof typeof CODES, text: string): string {
  return io.color ? `\x1b[${CODES[style]}m${text}\x1b[0m` : text;
}
