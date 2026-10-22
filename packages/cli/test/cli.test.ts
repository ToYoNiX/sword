import { execFile, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from '../src/cli.ts';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'sword-cli-'));
  dirs.push(dir);
  return dir;
}

async function vault(files: Record<string, string>): Promise<string> {
  const root = await tempDir();
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** Runs the CLI in-process at a fixed "now", capturing its output. */
async function sword(args: string[], cwd: string, now = '2026-10-24T21:00:00Z') {
  let out = '';
  let err = '';
  const code = await run(args, {
    cwd: () => cwd,
    now: () => now,
    out: (text) => (out += text),
    err: (text) => (err += text),
    color: false,
  });
  return { code, out, err };
}

const config = `time_zone: Africa/Cairo
anchors:
  work: { start: "09:00", end: "17:00", on: [sun, mon, tue, wed, thu], busy: true }
`;

const tasks = {
  'tasks/study-go.md': '---\ntitle: Study Go\nduration: 45m\nrepeat: daily\nbefore: work.start or 08:00\nprefer: latest\n---\n',
  'tasks/report.md': '---\ntitle: Write report\nduration: 2h\nafter: work\ndeadline: 2026-10-26\n---\n',
  'tasks/idea.md': '---\ntitle: Look into CalDAV\nduration: 30m\n---\n',
};

describe('sword', () => {
  it('prints usage for --help, and exits 2 for an unknown command', async () => {
    const help = await sword(['--help'], await tempDir());
    expect(help.code).toBe(0);
    expect(help.out).toContain('sword plan');
    const unknown = await sword(['frobnicate'], await tempDir());
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('unknown command "frobnicate"');
  });

  it('explains what to do outside a vault', async () => {
    const result = await sword(['plan'], await tempDir());
    expect(result.code).toBe(1);
    expect(result.err).toContain('sword init');
  });
});

describe('sword init', () => {
  it('creates a vault that checks and plans cleanly', async () => {
    const dir = join(await tempDir(), 'calendar');
    const init = await sword(['init', dir], tmpdir());
    expect(init.code).toBe(0);
    expect(await readFile(join(dir, 'sword.yaml'), 'utf8')).toContain('time_zone:');
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toContain('.sword/');
    expect((await sword(['check'], dir)).code).toBe(0);
    expect((await sword(['plan'], dir)).code).toBe(0);
  });

  it('refuses to overwrite an existing vault', async () => {
    const dir = await vault({ 'sword.yaml': config });
    const result = await sword(['init'], dir);
    expect(result.code).toBe(1);
    expect(result.err).toContain('already');
    expect(await readFile(join(dir, 'sword.yaml'), 'utf8')).toBe(config);
  });
});

describe('sword check', () => {
  it('passes a healthy vault', async () => {
    const result = await sword(['check'], await vault({ 'sword.yaml': config, ...tasks }));
    expect(result.code).toBe(0);
    expect(result.out).toContain('3 tasks, no problems');
  });

  it('reports file problems and engine errors by file, and exits 1', async () => {
    const dir = await vault({
      'sword.yaml': config,
      'tasks/bad.md': '---\nduration: 45\n---\n',
      'tasks/typo.md': '---\nduration: 30m\nafter: prayer.fajrr\n---\n',
      'tasks/odd.md': '---\nduration: 30m\nbefor: 08:00\n---\n',
    });
    const result = await sword(['check'], dir);
    expect(result.code).toBe(1);
    expect(result.out).toContain('tasks/bad.md');
    expect(result.out).toContain('tasks/typo.md');
    expect(result.out).toContain('prayer.fajrr');
    expect(result.out).toContain('tasks/odd.md');
    expect(result.out).toContain('2 errors, 1 warning');
  });

  it('reports a setting the engine rejects as a problem in sword.yaml', async () => {
    const result = await sword(['check'], await vault({ 'sword.yaml': 'day_start: prayer.fajr.start\n' }));
    expect(result.code).toBe(1);
    expect(result.out).toContain('sword.yaml');
    expect(result.out).toContain('prayer.fajr');
  });
});

describe('sword plan', () => {
  it('prints each day with its tasks, then what is unplaced and the inbox', async () => {
    const dir = await vault({ 'sword.yaml': config, ...tasks });
    // Sunday Oct 25, 00:00 in Cairo.
    const result = await sword(['plan', '--days', '3'], dir);
    expect(result.code).toBe(0);
    const out = result.out;
    expect(out).toContain('Sun 25 Oct');
    expect(out).toContain('08:15–09:00  Study Go');
    expect(out).toContain('17:00–19:00  Write report');
    expect(out).toContain('Tue 27 Oct');
    expect(out).not.toContain('Wed 28 Oct');
    expect(out).toMatch(/Inbox\n\s+Look into CalDAV/);
  });

  it('marks done, pinned and missed occurrences', async () => {
    const dir = await vault({
      'sword.yaml': config,
      'tasks/study-go.md': '---\ntitle: Study Go\nduration: 45m\nrepeat: daily\nbefore: work.start or 08:00\nprefer: latest\npins:\n  - 2026-10-26 06:30\n---\n',
      'log/2026-10.jsonl': `${JSON.stringify({ at: '2026-10-25T10:00:00Z', occurrence: 'study-go@2026-10-25', state: 'done', start: '2026-10-25T05:15:00Z', end: '2026-10-25T06:00:00Z' })}\n`,
    });
    const out = (await sword(['plan', '--days', '2'], dir)).out;
    expect(out).toContain('08:15–09:00  Study Go · done');
    expect(out).toContain('06:30–07:15  Study Go · pinned');
  });

  it('lists what could not be placed, with the reason', async () => {
    const dir = await vault({
      'sword.yaml': config,
      'tasks/long.md': '---\ntitle: Long read\nduration: 10h\nrepeat: daily\nbefore: work.start\n---\n',
    });
    const out = (await sword(['plan', '--days', '1'], dir)).out;
    expect(out).toMatch(/Unplaced\n\s+Long read \(Sun 25 Oct\): no free 10h slot/);
  });

  it("keeps today's already-past windows out of Unplaced, with a short note", async () => {
    const dir = await vault({ 'sword.yaml': config, ...tasks });
    // Sunday Oct 25, 20:00 in Cairo: Study Go's window (before 09:00) has passed.
    const out = (await sword(['plan', '--days', '2'], dir, '2026-10-25T17:00:00Z')).out;
    expect(out).not.toContain('Unplaced');
    expect(out).toContain('1 occurrence earlier today was not planned');
  });

  it('shows a note\'s file name when it has no title', async () => {
    const dir = await vault({ 'sword.yaml': config, 'tasks/Read Al-Kahf.md': '---\nduration: 20m\nrepeat: daily\nafter: 07:00\n---\n' });
    const out = (await sword(['plan', '--days', '1'], dir)).out;
    expect(out).toContain('07:00–07:20  Read Al-Kahf');
  });

  it('prints the raw plan with --json', async () => {
    const dir = await vault({ 'sword.yaml': config, ...tasks });
    const plan = JSON.parse((await sword(['plan', '--json', '--days', '2'], dir)).out);
    expect(plan.days).toHaveLength(2);
    expect(plan.placements.length).toBeGreaterThan(0);
    expect(plan.inbox).toEqual(['idea']);
  });

  it('finds the vault from a subfolder, or uses --dir', async () => {
    const dir = await vault({ 'sword.yaml': config, ...tasks });
    expect((await sword(['plan'], join(dir, 'tasks'))).code).toBe(0);
    expect((await sword(['plan', '--dir', dir], await tempDir())).code).toBe(0);
  });

  it('rejects a bad option value', async () => {
    const result = await sword(['plan', '--days', 'many'], await vault({ 'sword.yaml': config }));
    expect(result.code).toBe(2);
    expect(result.err).toContain('--days');
  });

  it('refuses to plan when files have errors', async () => {
    const result = await sword(['plan'], await vault({ 'sword.yaml': config, 'tasks/bad.md': '---\nduration: 45\n---\n' }));
    expect(result.code).toBe(1);
    expect(result.err).toContain('sword check');
  });
});

describe('sword apply', () => {
  const study = '---\ntitle: Study Go\nduration: 45m\nrepeat: daily\nbefore: work.start or 08:00\nprefer: latest\n---\n\nChapter 7.\n';

  it('saves the plan in the task files; afterwards there is nothing to apply', async () => {
    const dir = await vault({ 'sword.yaml': config, 'tasks/study-go.md': study });
    const preview = await sword(['plan', '--days', '2'], dir);
    expect(preview.out).toContain('Changes, not applied yet\n  2 new\nRun "sword apply" to save them in your task files.\n');

    const applied = await sword(['apply', '--days', '2'], dir);
    expect(applied.code).toBe(0);
    expect(applied.out).toBe('Applied: 2 new.\nUpdated 1 task file.\n');
    expect(await readFile(join(dir, 'tasks/study-go.md'), 'utf8')).toBe(
      '---\ntitle: Study Go\nduration: 45m\nrepeat: daily\nbefore: work.start or 08:00\nprefer: latest\nplanned:\n  - 2026-10-25 08:15\n  - 2026-10-26 08:15\n---\n\nChapter 7.\n',
    );

    expect((await sword(['plan', '--days', '2'], dir)).out).not.toContain('Changes');
    expect((await sword(['apply', '--days', '2'], dir)).out).toBe('Nothing to apply: your task files already hold this plan.\n');
  });

  it('explains moves, and logs what was missed once the time has passed', async () => {
    const dir = await vault({ 'sword.yaml': config, 'tasks/study-go.md': study });
    await sword(['apply', '--days', '2'], dir);
    // Study Go now has to end by 08:30: the planned 08:15–09:00 no longer fits.
    const edited = (await readFile(join(dir, 'tasks/study-go.md'), 'utf8')).replace('work.start or 08:00', '08:30');
    await writeFile(join(dir, 'tasks/study-go.md'), edited);
    const moved = await sword(['plan', '--days', '2'], dir);
    expect(moved.out).toContain('Study Go (Sun 25 Oct): 08:15 → 07:45, because it is outside its window');

    // Monday 10:00 in Cairo: Sunday's 08:15 came and went.
    const later = await sword(['apply', '--days', '2'], dir, '2026-10-26T07:00:00Z');
    expect(later.out).toContain('Study Go (Sun 25 Oct): missed');
    expect(await readFile(join(dir, 'log/2026-10.jsonl'), 'utf8')).toContain('"occurrence":"study-go@2026-10-25","state":"missed"');
  });

  it('reports a task file that could not be updated, and exits 1', async () => {
    const dir = await vault({ 'sword.yaml': config, 'tasks/study-go.md': study.replace('prefer: latest\n', 'prefer: latest\nplanned: &p\n  - 2026-10-20 08:15\nother: *p\n') });
    const result = await sword(['apply', '--days', '1'], dir);
    expect(result.code).toBe(1);
    expect(result.err).toContain("tasks/study-go.md was not updated: its frontmatter is written in a way Sword can't safely edit");
  });

  it('refuses to apply when files have errors, and changes nothing', async () => {
    const dir = await vault({ 'sword.yaml': config, 'tasks/study-go.md': study, 'tasks/bad.md': '---\nduration: 45\n---\n' });
    const result = await sword(['apply'], dir);
    expect(result.code).toBe(1);
    expect(result.err).toContain('sword check');
    expect(await readFile(join(dir, 'tasks/study-go.md'), 'utf8')).toBe(study);
  });
});

describe('sword done', () => {
  const files = {
    'sword.yaml': config,
    'tasks/study-go.md': '---\ntitle: Study Go\nduration: 45m\nrepeat: daily\nbefore: work.start or 08:00\nprefer: latest\nplanned: 2026-10-25 08:15\n---\n',
    'tasks/report.md': '---\ntitle: Write report\nduration: 2h\nafter: work\ndeadline: 2026-10-26\n---\n',
  };
  // Sunday Oct 25, 10:00 in Cairo.
  const now = '2026-10-25T07:00:00Z';

  it("marks today's occurrence done, by note name or title, and undoes it", async () => {
    const dir = await vault(files);
    const done = await sword(['done', 'Study Go'], dir, now);
    expect(done).toMatchObject({ code: 0, out: 'Study Go (Sun 25 Oct) is done.\n' });
    expect((await sword(['plan', '--days', '1'], dir, now)).out).toContain('08:15–09:00  Study Go · done');

    const undo = await sword(['done', '--undo', 'study-go'], dir, now);
    expect(undo).toMatchObject({ code: 0, out: 'Study Go (Sun 25 Oct) is not done anymore.\n' });
    expect((await sword(['plan', '--days', '1'], dir, now)).out).toContain('08:15–09:00  Study Go · missed');
    expect((await readFile(join(dir, 'log/2026-10.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l).state)).toEqual(['done', 'open']);
  });

  it('marks a one-off task, and another day with --date', async () => {
    const dir = await vault(files);
    expect((await sword(['done', 'report'], dir, now)).out).toBe('Write report is done.\n');
    expect((await sword(['done', 'study-go', '--date', '2026-10-26'], dir, now)).out).toBe('Study Go (Mon 26 Oct) is done.\n');
  });

  it.each<[string, string[], number, string]>([
    ['no task', ['done'], 2, 'which task'],
    ['two tasks', ['done', 'a', 'b'], 2, 'one task at a time'],
    ['an unknown task', ['done', 'nope'], 1, 'no task named "nope"'],
    ['a date on a one-off task', ['done', 'report', '--date', '2026-10-25'], 1, 'Write report is a one-off task'],
    ['a bad date', ['done', 'study-go', '--date', 'friday'], 1, '"friday" is not a date'],
    ['undoing something not done', ['done', '--undo', 'study-go'], 1, 'Study Go is not marked done on Sun 25 Oct'],
  ])('refuses %s', async (_, args, code, message) => {
    const result = await sword(args, await vault(files), now);
    expect(result.code).toBe(code);
    expect(result.err).toContain(message);
  });
});

describe('sword export', () => {
  it('prints the plan as iCalendar', async () => {
    const dir = await vault({ 'sword.yaml': config, ...tasks });
    const result = await sword(['export', '--days', '2'], dir);
    expect(result.code).toBe(0);
    expect(result.out).toContain('BEGIN:VCALENDAR');
    expect(result.out).toContain('SUMMARY:Study Go');
    expect(result.out).toContain('UID:sword-study-go@2026-10-25');
  });

  it('writes to a file with --out', async () => {
    const dir = await vault({ 'sword.yaml': config, ...tasks });
    const result = await sword(['export', '--out', 'plan.ics'], dir);
    expect(result.code).toBe(0);
    expect(await readFile(join(dir, 'plan.ics'), 'utf8')).toContain('BEGIN:VEVENT');
    expect(result.out).toContain('plan.ics');
  });
});

describe('the sword command', () => {
  const main = fileURLToPath(new URL('../src/main.ts', import.meta.url));

  it('runs on plain Node, with no build step', async () => {
    const { stdout } = await promisify(execFile)(process.execPath, [main, '--help']);
    expect(stdout).toContain('sword plan');
  });

  /** Runs shell commands from inside a folder that is deleted first, like a shell left in a removed folder. */
  async function fromDeletedFolder(commands: string): Promise<{ code: number; stdout: string; stderr: string }> {
    const gone = join(await tempDir(), 'gone');
    const script = `mkdir "${gone}" && cd "${gone}" && rm -rf "${gone}" && ${commands.replaceAll('$GONE', gone)}`;
    // As when run from your shell: not under pnpm, which would set INIT_CWD.
    const { INIT_CWD: _, ...env } = process.env;
    return new Promise((done) => {
      execFile('sh', ['-c', script], { env: { ...env, SWORD: `"${process.execPath}" "${main}"` } }, (error, stdout, stderr) => {
        done({ code: error ? Number(error.code ?? 1) : 0, stdout, stderr });
      });
    });
  }

  it('can create a vault while the current folder no longer exists', async () => {
    const target = join(await tempDir(), 'calendar');
    const result = await fromDeletedFolder(`eval "$SWORD init ${target}"`);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(await readFile(join(target, 'sword.yaml'), 'utf8')).toContain('time_zone:');
  });

  it('uses the folder again once it has been recreated at the same path', async () => {
    const result = await fromDeletedFolder('eval "$SWORD init $GONE" && eval "$SWORD plan --days 1"');
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    // The plan's header line (what's in the plan depends on the time of day).
    expect(result.stdout).toMatch(/\n\S+ · now \w{3} \d+ \w{3} \d{2}:\d{2}\n/);
  });

  it('plans, applies, marks done and undoes, as a real process', async () => {
    const dir = join(await tempDir(), 'calendar');
    const exec = (args: string[]) => promisify(execFile)(process.execPath, [main, ...args, '--dir', dir]);
    await promisify(execFile)(process.execPath, [main, 'init', dir]);
    await exec(['apply']);
    expect(await readFile(join(dir, 'tasks/plan-the-day.md'), 'utf8')).toContain('planned:\n  - ');
    expect((await exec(['done', 'plan-the-day'])).stdout).toContain('Plan the day');
    expect((await exec(['done', '--undo', 'Plan the day'])).stdout).toContain('is not done anymore');
    const log = (await readdir(join(dir, 'log'))).map((f) => join(dir, 'log', f));
    const lines = (await Promise.all(log.map((f) => readFile(f, 'utf8')))).join('').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.slice(-2).map((l) => l.state)).toEqual(['done', 'open']);
    expect(lines.at(-1).at).toMatch(/:\d{2}Z$/);
  });

  it('serves the vault to an agent over MCP, and exits when the agent disconnects', async () => {
    const dir = await vault({ 'sword.yaml': config, ...tasks });
    const transport = new StdioClientTransport({ command: process.execPath, args: [main, 'mcp', '--dir', dir], stderr: 'pipe' });
    let stderr = '';
    transport.stderr?.on('data', (chunk) => (stderr += String(chunk)));
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(transport);
    expect((await client.listTools()).tools.map((t) => t.name)).toContain('plan');
    const plan = await client.callTool({ name: 'plan', arguments: { days: 2 } });
    expect(plan.structuredContent).toMatchObject({ timeZone: 'Africa/Cairo', titles: { 'study-go': 'Study Go' } });
    const pid = transport.pid;
    await client.close();
    await expect.poll(() => isRunning(pid), { timeout: 5000 }).toBe(false);
    expect(stderr).toBe('');
  });

  it('also speaks the 2025 MCP handshake that older agent apps use', async () => {
    const dir = await vault({ 'sword.yaml': config, ...tasks });
    const child = spawn(process.execPath, [main, 'mcp', '--dir', dir]);
    const replies: { id: number; result?: { protocolVersion?: string; tools?: { name: string }[] } }[] = [];
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        replies.push(JSON.parse(buffer.slice(0, i)));
        buffer = buffer.slice(i + 1);
      }
    });
    const send = (message: object) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'old-app', version: '1.0.0' } } });
    await expect.poll(() => replies.length).toBe(1);
    send({ method: 'notifications/initialized' });
    send({ id: 2, method: 'tools/list', params: {} });
    await expect.poll(() => replies.length).toBe(2);
    child.stdin.end();
    expect(replies[0]?.result?.protocolVersion).toBe('2025-06-18');
    expect(replies[1]?.result?.tools?.map((t) => t.name)).toContain('apply');
  });

  it('refuses to serve a folder that is not a vault, on stderr', async () => {
    const result = await promisify(execFile)(process.execPath, [main, 'mcp', '--dir', await tempDir()]).catch((e: { code: number; stdout: string; stderr: string }) => e);
    expect(result).toMatchObject({ code: 1, stdout: '' });
    expect(result.stderr).toContain('is not a Sword vault');
  });

  it('explains the problem, without a stack trace, when the folder is really gone', async () => {
    const result = await fromDeletedFolder('eval "$SWORD plan"');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('the current folder no longer exists');
    expect(result.stderr).not.toMatch(/^\s+at /m);
  });
});

function isRunning(pid: number | null | undefined): boolean {
  if (pid === null || pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
