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
| `sword sync [--days N]` | Publish the schedule to a CalDAV calendar, e.g. Radicale (see below) |
| `sword mcp` | Serve the vault to an agent app over MCP (see below) |
| `sword plugin add REPO` | Install a plugin from a git URL or a local path |

Commands find the vault the current folder is in, like git, or take `--dir`.
Tasks are Markdown files in `tasks/`; see the
[design document](docs/design.md#113-task-files) for the format. Sword keeps
no database: everything, including the applied plan, is in your files.

### Seeing it in a calendar app

`sword sync` publishes the plan to a CalDAV calendar, such as a
[Radicale](https://radicale.org) server, so any calendar app can show it
(Thunderbird, GNOME Calendar, DAVx⁵ on Android, …):

```yaml
# sword.yaml
caldav:
  url: http://localhost:5232/you/sword/
  username: you
```

The password goes in `SWORD_CALDAV_PASSWORD`, never in the vault. Each run
creates the calendar if needed, adds and updates events, and removes ones no
longer planned. It only touches events Sword made, and events that are over
stay as history. Run it again after `sword apply`, or whenever the plan
changes.

### Plugins

A plugin is a git repository with a `manifest.json` and a bundled `main.js`,
like an Obsidian plugin, so installing needs nothing but the download. For
prayer times as anchors:

```sh
sword plugin add https://github.com/ToYoNiX/sword-prayer
```

```yaml
# sword.yaml
time_zone: Africa/Cairo
location: { latitude: 30.0444, longitude: 31.2357 }
prayer:
  method: egyptian
```

Then tasks can say `after: prayer.asr`, and follow Asr as it moves through the
year. Plugins only add things (here, anchors named `prayer.*`); they never
change Sword itself.

### Using it from an agent

`sword mcp` lets an agent app read and change your plan through MCP: the
same operations as the CLI (`plan`, `apply`, `done`, `undo_done`, `check`,
`export`), plus `create_task`, `update_task` and `delete_task`, with the same
rules. The agent gives rules, never times: Sword places the tasks. The app
starts it when it needs it, so there is nothing to run by hand. With Claude
Code:

```sh
claude mcp add sword -- node ~/path/to/sword/packages/cli/src/main.ts mcp --dir ~/my-calendar
```

Pass `--dir`: the app may start it from any folder.

## AI-first, measured

Most calendars get AI support by adding an MCP server on top of a calendar of
fixed times. Then **the agent is the scheduler**: it has to work out every
time itself, and every change in the week becomes more tool calls and more
arithmetic for it to get wrong. In Sword the agent only changes rules, and
**Sword's scheduler works out the times**, the same way every time.

We tested that claim in October 2026. We ran the same week through
[Super Productivity](https://super-productivity.com) via a community MCP
server for it, and through `sword mcp`, counting every call.

**Setup.** One week (Thu Oct 22 to Wed Oct 28) of a real routine: the five
daily prayers in Cairo, morning and evening adhkar, problem solving, a
treadmill hour, gym, a work block and two meetings a week. Into it went 20 real
tasks: 9 Go course sections and 11 GitHub issues, 32 hours in total, due by
Wednesday, between 09:00 and 23:00. A script judged every result against the
prayers, the routine, the other tasks, those hours and the deadline.

| Phase | Super Productivity | Sword |
|---|---|---|
| Plan a sprint of 20 tasks | 21 calls, 20 times worked out by the agent | 22 calls, none |
| Replace 10 of them with 10 others | 21 calls, 10 times worked out | 22 calls, none |
| "Out all Saturday, 09:00–18:00" | 4 calls, 3 times worked out; the routine not handled | 3 calls; the routine handled too |
| Prayer times shift by 15 minutes | 21 calls, 20 times worked out (15 collisions, 5 knock-on moves); 28 routine occurrences not handled | 2 calls (none once a server runs); 48 moves, each with its reason |
| **Total** | **67 calls (+31 for the routine), 53 times worked out by the agent, ~400,000 characters read** | **49 calls, no times worked out, ~190,000 characters read** |
| Judged problems | 0 | 0 |

What it shows:

- **Adding and removing tasks costs the same** in both: one call per task.
  Sword doesn't save those.
- **Rearranging is the difference.** In a fixed-time calendar, every
  disruption becomes agent work, and it grows with the number of tasks it
  touches. Moving one task can push the next out of its slot: after the prayer
  shift, the agent had to move a Sunday task to Monday because nothing else
  fitted. In Sword, rearranging costs the agent nothing.
- **Super Productivity's 0 problems took 53 careful calculations.** Its MCP
  server can't tell the agent when the prayers are or where the routine sits,
  so for this test the agent was given both for free. Each of those 53 times
  is a chance for the mistakes Sword exists to prevent, like a task placed on
  top of a prayer. In Sword the agent works out none.

Notes on fairness:

- **Super Productivity's cheapest path was used:** one call per task, with the
  time and estimate set in the title (`@fri 15:10 t1h30m`).
- **This compares the MCP approach, not the apps:** Super Productivity is a
  good app for planning by hand.
- **Both used the same fixed stand-ins for prayer times,** since Sword's
  prayer plugin doesn't exist yet.

## Status

Early development. Working: the scheduling engine, reading and writing vaults,
the command layer, the CLI, MCP over stdio, and plugins that provide anchors.
Not yet: calendar import, the HTTP server (and remote MCP) and the UI.

Known gaps: no order between tasks, one occurrence can't be skipped or moved
to another day, and a day out is reported as conflicting with the prayers
inside it.

## Related

- [sword-prayer](https://github.com/ToYoNiX/sword-prayer): prayer times as
  anchors.

## License

[MIT](LICENSE)
