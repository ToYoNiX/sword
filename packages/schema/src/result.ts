import type { z } from 'zod';

/** Reading never throws: it returns the value or every problem found, plus warnings. */
export type Result<T> =
  | { readonly ok: true; readonly value: T; readonly warnings: string[] }
  | { readonly ok: false; readonly errors: string[]; readonly warnings: string[] };

export function issues(error: z.ZodError, prefix: string[] = []): string[] {
  return error.issues.map((issue) => {
    const path = [...prefix, ...issue.path.map(String)].join('.');
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });
}

export function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function unknownKeys(data: Record<string, unknown>, known: ReadonlySet<string>): string[] {
  return Object.keys(data).filter((key) => !known.has(key));
}
