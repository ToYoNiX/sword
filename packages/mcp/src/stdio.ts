import { serveStdio } from '@modelcontextprotocol/server/stdio';
import type { Context } from '@sword/commands';
import { createMcpServer } from './index.ts';

/**
 * Serves Sword over this process's stdin and stdout, for an agent app that
 * starts it (Claude Code, Claude Desktop). Local, so every tool is offered.
 * Nothing else may write to stdout while it runs.
 */
export function serveSwordStdio(ctx: Context, onerror?: (error: Error) => void): { close(): Promise<void> } {
  return serveStdio(() => createMcpServer(ctx), onerror === undefined ? {} : { onerror });
}
