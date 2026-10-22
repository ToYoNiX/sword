import { serveSwordStdio } from '@sword/mcp/stdio';
import type { Io } from '../io.ts';
import { context } from '../vault.ts';

/**
 * Serves the vault to an agent app over MCP on stdin and stdout, until the
 * app closes the connection. Started by the app, so there is nothing to run
 * by hand. stdout belongs to MCP: problems go to stderr.
 */
export async function mcp(io: Io, dir: string | undefined): Promise<number> {
  const ctx = await context(io, dir);
  serveSwordStdio(ctx, (error) => io.err(`sword mcp: ${error.message}\n`));
  return 0;
}
