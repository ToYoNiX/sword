# Sword

> الوقت كالسيف إن لم تقطعه قطعك
>
> *Al-waqtu kas-sayfi, in lam taqṭaʿhu qaṭaʿak.*
>
> "Time is like a sword: if you don't cut it, it will cut you."
>
> — Arabic saying

Sword is a local-first calendar and task system where **you describe the rules
a task follows, and the schedule is computed from them**.

Traditional calendars store fixed times: "Study, 15:00–15:45, every day." When
your day moves (prayer times shift, a meeting lands, the sun rises earlier),
those blocks go stale and you drag them around by hand, or an AI agent puts
them on top of something they shouldn't overlap.

In Sword, a task says what it needs instead: "45 minutes, after Asr, before
Maghrib." A deterministic scheduler turns that into a concrete time for each
day, works it out again when something changes, and tells you why when nothing
fits. It never places a task where it doesn't belong.

- **Minimal core, everything else is a plugin.** Prayer times, sunrise, work
  shifts, sprints and habits are plugins that teach Sword about time. A plugin
  is just a git repo, with no store and no publishing step.
- **AI-first.** A built-in MCP server lets agents create tasks and rules. Agents
  write rules, never raw times, so they can't schedule into time you've blocked.
- **Plain files.** Your tasks are Markdown files with YAML frontmatter, so they
  work with Vim, git and Obsidian.
- **Standard interop.** Import from and publish to iCalendar and CalDAV
  (Radicale, Google Calendar, …).

## Why "Sword"

The saying above is the whole idea. If you don't shape your time, it shapes
you: fixed blocks collide with the things in your life that move, and your day
gets cut up by whatever lands first. Sword is a tool for cutting time yourself.

The project started as **Calendrome**. Another project
([mklute101/calendrome](https://github.com/mklute101/calendrome)) already uses
that name, so it is now Sword.

## Try it

Sword needs Node 24 and pnpm (`corepack enable` installs pnpm).

```sh
pnpm install
pnpm sword init ~/my-calendar     # a vault: sword.yaml and an example task
cd ~/my-calendar
pnpm --dir ~/path/to/sword sword plan
```

To run it as just `sword`, add an alias:

```sh
alias sword="node ~/path/to/sword/packages/cli/src/main.ts"
```

| Command | What it does |
|---|---|
| `sword init [dir]` | Create a vault with `sword.yaml` and an example task |
| `sword check` | List every problem in the vault, by file (exit 1 on errors) |
| `sword plan [--days N] [--json]` | Preview the schedule: each day, what changed since it was applied, what couldn't be placed, and the inbox. Writes nothing |
| `sword apply [--days N]` | Save the schedule: each task file gets a `planned` list of its times, and missed occurrences go to the log |
| `sword done TASK [--date D]` | Mark today's (or another day's) occurrence done |
| `sword done --undo TASK` | Undo a mistaken done, for today's occurrences |
| `sword export [--days N] [--out FILE]` | Write the schedule as iCalendar, e.g. to publish to Radicale |

Commands find the vault the current folder is in, like git, or take `--dir`.
Tasks are Markdown files in `tasks/`; see the
[design document](docs/design.md#113-task-files) for the format. Sword keeps
no database: everything, including the applied plan, is in your files.

## Status

Early development. Working: the scheduling engine, reading and writing vaults,
the command layer, and the CLI. Not yet: plugins (prayer times come from
[sword-playground](https://github.com/ToYoNiX/sword-playground) for now),
calendar import, the server, MCP and the UI.

## Related

- [sword-prayer](https://github.com/ToYoNiX/sword-prayer): prayer times as
  anchors.

## License

[MIT](LICENSE)
