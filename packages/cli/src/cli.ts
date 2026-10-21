import { parseArgs } from 'node:util';
import { check } from './commands/check.ts';
import { exportIcs } from './commands/export.ts';
import { init } from './commands/init.ts';
import { plan } from './commands/plan.ts';
import { CliError } from './io.ts';
import type { Io } from './io.ts';

const USAGE = `Usage: sword <command> [options]

Commands:
  sword init [dir]        create a vault (sword.yaml and an example task)
  sword check             list every problem in the vault, by file
  sword plan              print the schedule
  sword export            write the schedule as iCalendar (.ics)

Options:
  --dir <path>            the vault (default: the one the current folder is in)
  --days <n>              how many days to plan (default: the settings, or 7)
  --json                  print the raw plan as JSON (plan)
  --out <file>            write to a file instead of the screen (export)
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
    if (!(error instanceof CliError)) throw error;
    io.err(`sword: ${error.message}\n`);
    return error.code;
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
