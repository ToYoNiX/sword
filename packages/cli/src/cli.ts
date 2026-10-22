import { parseArgs } from 'node:util';
import { apply } from './commands/apply.ts';
import { check } from './commands/check.ts';
import { done } from './commands/done.ts';
import { exportIcs } from './commands/export.ts';
import { init } from './commands/init.ts';
import { mcp } from './commands/mcp.ts';
import { plugin } from './commands/plugin.ts';
import { plan } from './commands/plan.ts';
import { CommandError } from '@sword/commands';
import { CliError } from './io.ts';
import type { Io } from './io.ts';

const USAGE = `Usage: sword <command> [options]

Commands:
  sword init [dir]        create a vault (sword.yaml and an example task)
  sword check             list every problem in the vault, by file
  sword plan              preview the schedule, and what changed
  sword apply             save the schedule in your task files
  sword done <task>       mark today's occurrence of a task done
  sword done --undo <task>  undo that, for today's occurrences
  sword export            write the schedule as iCalendar (.ics)
  sword mcp               serve the vault to an agent app over MCP (stdio)
  sword plugin add <repo> install a plugin from a git URL or a local path

Options:
  --dir <path>            the vault (default: the one the current folder is in)
  --days <n>              how many days to plan (default: the settings, or 7)
  --json                  print the raw plan as JSON (plan)
  --out <file>            write to a file instead of the screen (export)
  --date <YYYY-MM-DD>     another day's occurrence (done)
  -h, --help              show this help
`;

export async function run(args: string[], io: Io): Promise<number> {
  const [command, ...rest] = args;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    io.out(USAGE);
    return 0;
  }
  try {
    switch (command) {
      case 'init':
        return await init(io, parsed(() => parseArgs({ args: rest, allowPositionals: true })).positionals);
      case 'check': {
        const { values } = parsed(() => parseArgs({ args: rest, options: { dir: { type: 'string' } } }));
        return await check(io, values.dir);
      }
      case 'plan': {
        const { values } = parsed(() =>
          parseArgs({ args: rest, options: { dir: { type: 'string' }, days: { type: 'string' }, json: { type: 'boolean' } } }),
        );
        return await plan(io, { dir: values.dir, days: days(values.days), json: values.json === true });
      }
      case 'apply': {
        const { values } = parsed(() => parseArgs({ args: rest, options: { dir: { type: 'string' }, days: { type: 'string' } } }));
        return await apply(io, { dir: values.dir, days: days(values.days) });
      }
      case 'done': {
        const { values, positionals } = parsed(() =>
          parseArgs({ args: rest, allowPositionals: true, options: { dir: { type: 'string' }, date: { type: 'string' }, undo: { type: 'boolean' } } }),
        );
        if (positionals.length === 0) throw new CliError(`which task? e.g. sword done "Study Go"\n\n${USAGE}`, 2);
        if (positionals.length > 1) throw new CliError('one task at a time; put a name with spaces in quotes: sword done "Study Go"', 2);
        return await done(io, { dir: values.dir, task: positionals[0] as string, date: values.date, undo: values.undo === true });
      }
      case 'plugin': {
        const { values, positionals } = parsed(() => parseArgs({ args: rest, allowPositionals: true, options: { dir: { type: 'string' } } }));
        return await plugin(io, positionals, values.dir, USAGE);
      }
      case 'mcp': {
        const { values } = parsed(() => parseArgs({ args: rest, options: { dir: { type: 'string' } } }));
        return await mcp(io, values.dir);
      }
      case 'export': {
        const { values } = parsed(() =>
          parseArgs({ args: rest, options: { dir: { type: 'string' }, days: { type: 'string' }, out: { type: 'string' } } }),
        );
        return await exportIcs(io, { dir: values.dir, days: days(values.days), out: values.out });
      }
      default:
        throw new CliError(`unknown command "${command}"\n\n${USAGE}`, 2);
    }
  } catch (error) {
    const failure = error instanceof CommandError ? fromCommand(error) : error;
    if (!(failure instanceof CliError)) throw error;
    io.err(`sword: ${failure.message}\n`);
    return failure.code;
  }
}

/** Runs parseArgs, turning bad options into a usage error. */
function parsed<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    throw new CliError(`${(error as Error).message}\n\n${USAGE}`, 2);
  }
}

function days(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 366) throw new CliError(`--days must be a whole number from 1 to 366, not "${value}"`, 2);
  return n;
}

/** A command's failure, as the CLI reports it. */
function fromCommand(error: CommandError): CliError {
  if (error.code === 'vault_errors') return new CliError(`${error.message}; run "sword check" to see them.`);
  return new CliError(error.message);
}
