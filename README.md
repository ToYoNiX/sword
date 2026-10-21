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

## Status

Early development. The scheduling engine (`packages/engine`) exists and is
tested; the vault, server, MCP and UI come next. See the
[design document](docs/design.md) for the full design.

## Related

- [sword-prayer](https://github.com/ToYoNiX/sword-prayer): prayer times as
  anchors.

## License

[MIT](LICENSE)
