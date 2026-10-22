/*
 * Sword over MCP: every command becomes a tool, with its name, description
 * and input schema taken from the command's definition. This package only
 * adapts; the rules are in the commands. Transports are separate: `sword mcp`
 * serves it over stdio, and the HTTP server will serve it remotely.
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { CommandError, allows, commands, invoke } from '@sword/commands';
import type { Command, Context, Scope } from '@sword/commands';

/** What the agent is told about Sword when it connects. */
export const INSTRUCTIONS = `Sword is a calendar where a task is a set of rules (a duration, "after" and "before" anchors such as work or prayer times, a repeat), not a fixed time. A deterministic scheduler turns the rules into times, so placements never overlap busy time, events or each other.

- Call plan to see the schedule. It changes nothing. Times are UTC instants; show them in the result's timeZone. Each placement's date is the user's logical day, and its why says why it is there; unplaced lists what could not be placed and why.
- Call apply to save the plan the user agreed to, passing the planId from that plan. It refuses if the plan has changed since.
- Call done when the user finished something; undo_done takes it back, the same day only.
- If a tool reports vault_errors, call check to see which files need fixing.`;

export interface McpOptions {
  /** What this caller may do. Tools outside these scopes aren't offered. Everything if left out (a local process). */
  scopes?: readonly Scope[];
}

/** An MCP server for one vault, ready to connect to a transport. */
export function createMcpServer(ctx: Context, options: McpOptions = {}): McpServer {
  const server = new McpServer({ name: 'sword', version: '0.0.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  for (const command of commands) {
    if (options.scopes !== undefined && !allows(options.scopes, command.scope)) continue;
    server.registerTool(
      command.name,
      { description: command.description, inputSchema: command.input, annotations: { readOnlyHint: command.scope === 'read' } },
      (args: unknown) => call(command, ctx, args, options.scopes),
    );
  }
  return server;
}

async function call(command: Command, ctx: Context, args: unknown, scopes: readonly Scope[] | undefined): Promise<CallToolResult> {
  try {
    const result = (await invoke(command, ctx, args, scopes === undefined ? {} : { scopes })) as Record<string, unknown>;
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  } catch (error) {
    if (!(error instanceof CommandError)) throw error;
    const hint = error.code === 'vault_errors' ? '; call the check tool to see them' : '';
    return { content: [{ type: 'text', text: `${error.code}: ${error.message}${hint}` }], isError: true };
  }
}
