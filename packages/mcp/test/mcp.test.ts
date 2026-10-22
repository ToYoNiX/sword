import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import type { Context, Scope } from '@sword/commands';
import { fileVault } from '@sword/vault';
import { createMcpServer } from '../src/index.ts';
import { vault } from './helpers.ts';

// Riyadh is UTC+3. Sunday Oct 25, 2026, 03:00 local.
const NOW = '2026-10-25T00:00:00Z';
const settings = 'time_zone: Asia/Riyadh\nhorizon_days: 2\n';
const study = '---\ntitle: Study Go\nduration: 45m\nrepeat: daily\nafter: 05:00\nbefore: 07:00\n---\n';

/** A client connected to Sword's MCP server for a vault, as an agent would be. */
async function connect(root: string, scopes?: Scope[]) {
  const ctx: Context = { vault: fileVault(root), now: () => NOW };
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(ctx, scopes === undefined ? {} : { scopes }).connect(serverSide);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientSide);
  return client;
}

const text = (result: { content?: unknown }) => (result.content as { type: string; text: string }[])[0]?.text ?? '';

describe('the MCP server', () => {
  it('introduces Sword to the agent', async () => {
    const client = await connect(await vault({ 'sword.yaml': settings }));
    expect(client.getServerVersion()).toMatchObject({ name: 'sword' });
    expect(client.getInstructions()).toContain('plan');
    expect(client.getInstructions()).toContain('apply');
  });

  it('offers every command as a tool, described from its definition', async () => {
    const client = await connect(await vault({ 'sword.yaml': settings }));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['check', 'plan', 'apply', 'done', 'undo_done', 'export']);
    const done = tools.find((t) => t.name === 'done');
    expect(done?.description).toContain('Mark an occurrence of a task done');
    expect(done?.inputSchema).toMatchObject({ type: 'object', properties: { task: { type: 'string' } }, required: ['task'] });
    expect(tools.find((t) => t.name === 'plan')?.annotations).toMatchObject({ readOnlyHint: true });
    expect(tools.find((t) => t.name === 'apply')?.annotations).toMatchObject({ readOnlyHint: false });
  });

  it('returns a command\'s result as structured data and as JSON text', async () => {
    const client = await connect(await vault({ 'sword.yaml': settings, 'tasks/study.md': study }));
    const result = await client.callTool({ name: 'plan', arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ timeZone: 'Asia/Riyadh', titles: { study: 'Study Go' }, planId: expect.any(String) });
    expect(JSON.parse(text(result))).toEqual(result.structuredContent);
  });

  it('changes the vault through write tools', async () => {
    const root = await vault({ 'sword.yaml': settings, 'tasks/study.md': study });
    const client = await connect(root);
    const { structuredContent } = await client.callTool({ name: 'plan', arguments: {} });
    const applied = await client.callTool({ name: 'apply', arguments: { planId: (structuredContent as { planId: string }).planId } });
    expect(applied.structuredContent).toMatchObject({ applied: { files: ['tasks/study.md'] } });
    const done = await client.callTool({ name: 'done', arguments: { task: 'Study Go' } });
    expect(done.structuredContent).toEqual({ occurrenceId: 'study@2026-10-25', task: 'study', title: 'Study Go', date: '2026-10-25', state: 'done' });
  });

  it('reports a refused command as a tool error the agent can read', async () => {
    const client = await connect(await vault({ 'sword.yaml': settings, 'tasks/study.md': study }));
    const result = await client.callTool({ name: 'done', arguments: { task: 'nope' } });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('not_found: no task named "nope"');
  });

  it('points to the check tool when files have errors', async () => {
    const client = await connect(await vault({ 'sword.yaml': settings, 'tasks/bad.md': '---\nduration: 45\n---\n' }));
    const result = await client.callTool({ name: 'plan', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toBe('vault_errors: 1 problem in your files; call the check tool to see them');
  });

  it('rejects input that does not match the schema, naming the field', async () => {
    const client = await connect(await vault({ 'sword.yaml': settings }));
    const outcome = await client.callTool({ name: 'done', arguments: { task: 5 } }).then(
      (result) => text(result),
      (error: Error) => error.message,
    );
    expect(outcome).toContain('task: Invalid input: expected string, received number');
  });

  it('only offers the tools a caller\'s scopes allow', async () => {
    const client = await connect(await vault({ 'sword.yaml': settings }), ['read']);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['check', 'plan', 'export']);
    const outcome = await client.callTool({ name: 'apply', arguments: {} }).then(
      (result) => (result.isError ? text(result) : 'ran'),
      (error: Error) => error.message,
    );
    expect(outcome).toContain('Tool apply not found');
  });
});
