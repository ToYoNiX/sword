# Sword — System Design

> Status: draft · Started 2026-10-21

The name comes from the Arabic saying *al-waqtu kas-sayf*, "time is like a
sword" (see the [README](../README.md)).

## 1. Thesis

**In Sword you describe the rules a task follows, and the schedule is computed from them.**

Traditional calendars store *times*: "Study, 15:00–15:45, daily." When the world
moves (prayer times shift, a meeting lands, the sun rises earlier), the stored
time goes stale. Then the user drags the block by hand, or an AI agent places
it on top of something it shouldn't.

Sword stores *conditions*: "Study, 45 minutes, after Asr, before Maghrib,
never overlapping a prayer." A deterministic scheduler turns those conditions
into concrete times for each day. When the inputs change, it computes the times
again. When no valid time exists, it says so and explains why. It never places
a task on top of something it must not overlap.

Think of a spreadsheet. A traditional calendar is a sheet of typed-in values.
Sword is a sheet of formulas. Plugins supply the inputs (Fajr is 04:52
today), and the calendar view is the evaluated result.

## 2. The core idea

### 2.1 A task has no start or end time

A task (an **Intention**) is defined only by its attributes:

- **duration**: how long it takes
- **rules**: which anchors it follows, which windows it must fit in, and what it must avoid
- **recurrence**: whether, and how often, it repeats
- **priority / deadline / preferences**: how to choose when several times are valid

Start and end are **outputs** of the scheduler. They are never inputs to the
definition.

A fixed time is not a special case. `at: 09:00` is just an anchor that happens
to be a constant. A meeting at 14:00 and a task "right after Fajr" use the same
mechanism; one input is constant and the other changes daily.

### 2.2 What is stored, and what is computed

| Thing | Where (§11) | Role |
|---|---|---|
| Intention definitions (rules, duration, recurrence) | Files, source of truth | What the user means |
| Overrides and pins ("this one occurrence at 07:00") | Files, as explicit rules | User intent, never a silent mutation |
| Completion history (done / missed / dropped) | Files, append-only log | What actually happened |
| Anchors (Fajr today, sunrise, work start) | Index (cache) | Inputs, computed by providers |
| Placements (Study → 05:20–06:05 on Oct 22) | Index (derived) | Outputs, kept for stability, sync, and undo |

Placements are stored because they must stay stable. The user needs to trust
that their afternoon doesn't reshuffle every time they open the app. External
calendars also need concrete events. Placements are still always *derived*:
each one records the inputs it was computed from, so the system knows when it
is stale. A placement can be deleted at any time and recomputed from the
definitions.

## 3. Glossary

| Term | Meaning |
|---|---|
| **Event** | Something with an authoritative real-world time that Sword does not decide, e.g. an imported meeting or a holiday. Usually blocks time. |
| **Anchor** | A named, resolvable reference in time, supplied by a provider for each logical day. It has a *window* and optionally a *busy* portion. Examples: `prayer.asr`, `sun.rise`, `work`, `day`. |
| **Provider** | A component (usually a plugin) that resolves anchors for a given day and location. |
| **Intention** | Something the user wants to do: a task, routine, or habit instance. Has a duration and rules, but no times. |
| **Rule** | A condition on where an occurrence may be placed. It is either **hard** (must hold) or **soft** (a preference). |
| **Occurrence** | One instance of an intention on one logical day (or one instance of a one-off task). |
| **Placement** | The concrete interval the scheduler assigned to an occurrence, with a state (§7). |
| **Logical day** | The user's notion of "a day", running from `day.start` to the next `day.start`. Not necessarily midnight to midnight. |
| **Horizon** | How far ahead the scheduler materializes placements (default 14 days). |
| **Plan** | The scheduler's output: proposed placements, a diff against the current state, and unplaced occurrences with reasons. |

## 4. Time model

### 4.1 Anchors are windows, not points

Real-world anchors have extent. Asr is not "15:47". It is:

```
prayer.asr
  window: 15:47 ──────────────────────────── 18:21   (valid until Maghrib)
  busy:   15:47 ── 16:07                             (when I actually pray)
```

- **window**: the period during which the anchor is "in effect".
- **busy**: the part that occupies the user's time. There can be zero or more
  busy intervals, and each is configurable. For example, busy can be set to the
  mosque's iqama time plus 20 minutes rather than the adhan time.

Rules can reference any edge explicitly:

| Reference | Resolves to |
|---|---|
| `prayer.asr.start` / `prayer.asr.end` | window edges |
| `prayer.asr.busy.start` / `prayer.asr.busy.end` | busy edges |
| `X` with `after:` | `busy.end` if X has a busy portion, else `window.end` |
| `X` with `before:` | `busy.start` if X has a busy portion, else `window.start` |
| `X` with `at:` | `busy.end` if X has a busy portion, else `window.start` |

The shorthand defaults follow everyday language. If an anchor has a busy
portion, that's the part that matters: "after Asr" means after I have prayed,
not after Asr's whole window ends at Maghrib. Otherwise the window is the thing
itself: "after work" means after work ends, "before work" means before it
starts, and "at afternoon" means when the afternoon starts. With several busy
portions, "before" means before the first and "after" means after the last.

Point-like anchors such as `sun.rise` simply have `window.start == window.end`
and no busy portion. Constant times (`09:00`) are anchors of the same kind.

### 4.2 The logical day is an anchor

`day` is a core anchor with a default provider (00:00 local). Its start can be
redirected to any other anchor:

```yaml
day:
  start: prayer.fajr.start     # or sun.rise, or 05:00, or prayer.maghrib.start
```

Everything that says "daily", "today", or "tonight", and every day or week view
boundary, uses the logical day, not the civil date. A task done at 01:30
belongs to the *previous* logical day if the day starts at Fajr.

Each occurrence belongs to exactly one logical day, and anchors are resolved
relative to that day. Within a day's rules, `prayer.isha` means *this logical
day's* Isha even if it falls after midnight.

### 4.3 Day parts: anchors that always exist

The core provides named parts of every day, so rules always have something to
refer to, even with no plugins installed:

```yaml
# sword.yaml (defaults shown; change, add, or remove with null)
day_parts:
  morning:   { start: "05:00", end: "12:00" }
  afternoon: { start: "12:00", end: "17:00" }
  evening:   { start: "17:00", end: "21:00" }
  night:     { start: "21:00", end: day.end }
```

They are ordinary anchors with a window and no busy portion, so
`within: afternoon`, `before: evening` and `at: afternoon` all work. Times are
read on the civil date (an end before the start wraps past midnight) and then
clipped to the logical day, so with a day that starts at Fajr, the morning
never starts before Fajr. They also give AI agents natural words to use
("this afternoon").

### 4.4 Fixed anchors

Fixed times are just constant anchors, so `sword.yaml` can define them
directly, without a plugin:

```yaml
anchors:
  work:      { start: "09:00", end: "17:00", on: [sun, mon, tue, wed, thu], busy: true }
  gym_hours: { start: "18:00", end: "21:00", on: [mon, wed, fri] }
  night_shift: { start: "22:00", end: "06:00" }   # an end before the start is the next day
```

They exist only on their weekdays (every day if `on` is left out), so a rule
like `before: work.start or 12:00` falls back on days off. `busy: true` makes
them occupy time. Unlike day parts, they are not clipped to the logical day.

### 4.5 Time zones and locations

- All instants are stored in UTC. All anchors are resolved in the user's
  configured time zone and location for that day.
- Location can change per day (travel). Providers receive `(date, location, tz)`.
- DST and time zone math is delegated to a mature library and never
  reimplemented.

## 5. Intentions and rules

### 5.1 Two kinds of relative time

Keep these two clearly separate. They have different cost, predictability, and
failure modes.

**A. Pinned to an anchor (a formula).** The position is fully determined by
anchors. No search is needed.

```yaml
title: Morning Quran
duration: 20m
repeat: daily
at: prayer.fajr.busy.end + 5m
```

**B. Fitted into a window (a search).** The rules define a region of valid
positions, and the scheduler picks one.

```yaml
title: Study Go
duration: 45m
repeat: daily
after: prayer.fajr
before: work.start
avoid:
  - tag:meeting
prefer: earliest
```

A formula intention whose computed position violates a hard rule (e.g. it
lands on a meeting) is **not moved**. It is reported as a conflict, because
moving it would change what the user said.

Every time rule (`at`, `after`, `before`, `within`) can list **fallbacks**,
tried in order; the first that exists on that day is used:

```yaml
after: prayer.fajr
before: work.start or 12:00     # no work on Friday → before noon
```

### 5.2 Rule vocabulary (v1)

| Rule | Kind | Example | Meaning |
|---|---|---|---|
| `at` | hard | `at: prayer.fajr.busy.end + 5m` | Start exactly here (formula) |
| `after` | hard | `after: prayer.asr` | Start ≥ this instant |
| `before` | hard | `before: prayer.maghrib` | End ≤ this instant |
| `within` | hard | `within: work` | Entirely inside the anchor's window |
| `avoid` | hard | `avoid: [tag:focus]` | Also keep clear of matching time that is *not* busy (see below) |
| `deadline` | hard | `deadline: 2026-10-24` | Must end by this: a date means the end of that logical day; a date and time (`2026-10-24T17:00`) is read in your time zone |
| `date` | hard | `date: 2026-10-26` | A one-off belongs to this logical day (required for a one-off with `at`) |
| `repeat` | hard | `repeat: weekly` | Which logical days get an occurrence, with `repeat_every`, `repeat_on`, `repeat_day` and `repeat_since` (§5.4) |
| `prefer` | soft | `prefer: earliest` / `latest` / `packed` | Which valid slot to take; `packed` is the smallest gap that fits (§6.4) |
| `priority` | soft | `priority: 2` | Ordering when intentions compete; equal priority puts longer tasks first |
| `depends_on` | hard | `depends_on: task:draft-outline` | *Later.* Only after that occurrence is placed earlier (or done) |
| `gap` | soft | `gap: 10m` | *Later.* Preferred spacing from neighbors |
| `prefer: near` | soft | `prefer: { near: sun.rise }` | *Later.* Closest valid slot to an anchor |

Offsets (`+ 5m`, `- 15m`) apply to any anchor reference. Selectors (`tag:`,
`anchor:`, `event:`, `task:`) pick sets of events, anchors, or intentions.

**Busy time is always avoided.** No flexible occurrence may overlap anything
busy: busy events, the busy portions of anchors, and other placed tasks. This
needs no rule, so an agent that forgets to say "not during prayer" still can't
schedule into prayer time. `avoid` is only for time that is *not* busy, such as
a non-busy "focus" event, or an anchor without a busy portion (its whole window
is avoided).

**Global avoid rules** (`avoid` in `sword.yaml`) apply to every task, so
"never during my kids' school run" is declared once.

### 5.3 Missing anchors

Rules can reference anchors that don't exist on a given day (no `work` on
Friday). There is no hidden policy for this. Either:

- the rule lists a **fallback** (`before: work.start or 12:00`, or
  `within: gym_hours or evening`) and the first one that exists is used, or
- there is no fallback, and the occurrence is **unplaced** with the reason:
  "anchor `work` is not available on 2026-10-30".

Day parts (§4.3) always exist, so they make good last fallbacks.

An anchor id that doesn't exist on **any** day is not "missing" but an error on
the intention (`unknown_anchor`), so typos like `prayer.fajrr` are caught
instead of silently blocking every day.

### 5.4 Recurrence

Recurrence decides *which days* have an occurrence. Rules decide *where in the
day* it goes. Instead of the full RRULE language, which is hard to understand
in every app that exposes it, there is a small fixed menu that maps directly
to a UI:

| Property | Type | Meaning |
|---|---|---|
| `repeat` | text | `daily`, `weekly` or `monthly` |
| `repeat_every` | number | Every N days, weeks or months (default 1) |
| `repeat_on` | list | Weekdays, for weekly repeats: `mon` … `sun` |
| `repeat_day` | number | Day of the month, for monthly repeats (1–31) |
| `repeat_since` | date | The first possible date, and where "every N" counts from |

```yaml
repeat: weekly          # every Monday and Thursday
repeat_on:
  - mon
  - thu
```

```yaml
repeat: monthly         # every 3 months, on the 15th
repeat_every: 3
repeat_day: 15
repeat_since: 2026-09-15
```

- They are separate, flat properties rather than one nested value, so each
  shows in Obsidian's properties panel with its own field (§11.3).
- `repeat_since` is required when `repeat_every` is more than 1. The app fills
  it in when the task is created.
- Weeks run Monday to Sunday; every 2 weeks counts whole weeks from the week
  containing `repeat_since`.
- A weekly repeat without `repeat_on` uses the weekday of `repeat_since`; a
  monthly one without `repeat_day` uses its day of the month.
- `repeat_day: 31` falls on the last day of shorter months.
- Everything is counted in **logical days**.

### 5.5 The inbox

An intention with no recurrence, no window, and no deadline is **in the inbox**.
It exists but is not scheduled. There are three ways to schedule it:

1. Give it a window or deadline, and the scheduler places it.
2. Pin it manually, which creates a pinned placement.
3. Assign it to a container that supplies rules, such as a sprint (via a plugin).

## 6. The scheduler

### 6.1 Contract

```
schedule(definitions, anchors, events, existing placements, horizon)
  → Plan { days, placements, diff, unplaced[] with reasons, conflicts }
```

- **Deterministic**: the same inputs give the same plan. Ties are broken by
  stable keys (priority, length, deadline, date, id).
- **Pure**: computing a plan changes nothing. Applying a plan is a separate,
  explicit step.
- **Hard rules are never violated.** If no valid placement exists, the
  occurrence is unplaced and an explanation is returned.
- **Explainable**: every placement and every failure can answer "why here?" or
  "why not?"
- **Nothing is dropped silently**: every existing placement passed in comes
  back as a placement (planned, done or missed) or as a removal with a reason.
  This includes placements from days before the horizon.
- **Days are part of the output**: each logical day's boundaries and day parts,
  so a UI can draw them without re-implementing the day logic.

### 6.2 Algorithm (v1)

Greedy interval arithmetic is enough to start with.

1. Resolve anchors and events for every logical day in the horizon.
2. Generate occurrences from recurrence and one-off intentions.
3. Settle occurrences from history: `done` stays as history, a placement whose
   time passed without completion becomes `missed`, and one that has already
   started stays where it is: only the future is re-planned. There is no time
   tracking; a task is either done or not done.
4. Place **pinned** placements, then **formula** (`at:`) occurrences. Mark them
   busy. Record conflicts and do not move them.
5. Order the **fitted** occurrences: higher priority first, then **longer
   first** (more work, and harder to fit later), then earlier deadline, then
   earlier date, then id.
6. In that order, **keep** every existing placement that is still valid
   (stability), and mark it busy.
7. In that order, place each remaining occurrence:
   1. Compute the allowed region from the window rules and the deadline.
   2. Subtract busy time and anything matched by `avoid` or global avoid rules.
   3. Keep gaps at least as long as the duration, starting no earlier than now
      (rounded up to the minute).
   4. Pick a slot by `prefer` (earliest, latest, or packed), then mark it busy.
      A one-off without a `date` tries each day up to its deadline; `packed`
      compares gaps across all those days.
   5. If no slot exists, record it as unplaced with the reason and what is in
      the way.
8. Diff the result against the existing placements: added, moved (with the
   reason the old placement became invalid), removed, and newly missed.

The scheduler sits behind an interface. A constraint solver can replace the
greedy pass later without changing callers.

### 6.3 Stability

A plan should change as little as possible:

- A placement that is still valid is not moved just because a slightly better
  slot appeared.
- Only placements whose inputs changed (an anchor moved, an event was added, a
  rule was edited) are reconsidered.
- Every automatic move is recorded with its cause ("moved because Dhuhr shifted
  from 12:01 to 12:04 and overlapped") and can be undone.

### 6.4 Packing: lessons from memory allocation

Fitting tasks into free time is the same problem an operating system has when
fitting allocations into free memory, and it has the same failure: **external
fragmentation**, where there is enough free time in total but it is cut into
gaps too small for what's left.

> Free gaps: Mon 2h, Tue 1h, Wed 45m. Tasks: 30m, 1h, 1h45m.
> Earliest-first in the given order: 30m → Mon, 1h → Mon, 1h45m fits nowhere.
> Longest first, smallest gap that fits: 1h45m → Mon, 1h → Tue, 30m → Wed.

| Memory management | Sword |
|---|---|
| Free memory | Free time in the window (a day, a sprint) |
| Allocation request | Task with a duration |
| First fit / best fit | `prefer: earliest` / `prefer: packed` |
| Allocate largest first | Longer tasks go first at equal priority |
| Out of memory | Unplaced occurrences, with reasons; a soft error, everything else stays scheduled |
| Compaction | *Later:* "defragment my week", only on request and previewed, since it moves things |
| Paging | *Later:* splitting a long task into chunks with a minimum size |

Fitting the most work is NP-hard in general, so these are rules of thumb, not a
search for the perfect plan. Daily routines usually want `earliest`; sprint and
one-off work benefits from `packed`.

### 6.5 When the scheduler runs

- When a definition, event, or anchor changes (event driven).
- When the horizon rolls forward each logical day.
- On demand via `preview` (from the UI, CLI, or MCP).

## 7. Placement lifecycle

| State | Meaning | Can the scheduler move it? |
|---|---|---|
| `proposed` | In a plan that hasn't been applied | n/a |
| `scheduled` | Applied and flexible | Yes, if it becomes invalid |
| `pinned` | User fixed it at this time | No. It is reported if it conflicts |
| `blocked` | No valid slot exists | Retried on every run |
| `done` | Completed | No. It is history |
| `missed` | Its time passed without completion | No. See below |

### 7.1 Missed occurrences

A placement whose time has passed without being marked done becomes `missed`,
including one from yesterday or earlier, outside the planning horizon. Nothing
is rescheduled automatically. What happens next depends on the intention:

- **Recurring** (has `repeat`, e.g. a habit or routine): the occurrence is
  recorded as `missed` and closed. That day's instance is gone, the next one is
  scheduled as normal, and no action is needed.
- **One-off** (a task that must actually get done): the occurrence goes into
  the **Missed** section of the UI and stays there until the user (or an agent,
  via commands) **reschedules** it, which gives it new rules or a new deadline
  and re-plans it, or **drops** it.

The Missed section is also an MCP-readable list, so "go through what I missed
yesterday and re-plan it" is a normal agent request.

## 8. Plugins

### 8.1 Principle

The core knows nothing about prayer, sprints, or habits. It knows about time,
anchors, rules, intentions, and placements. **Plugins teach it new sources of
time and new kinds of work.**

### 8.2 Extension points

| Extension point | Example |
|---|---|
| **Anchor provider** | `prayer` resolves `prayer.fajr` … `prayer.isha` from location and calculation method |
| **Event source** | An iCal/CalDAV importer supplies meetings as events |
| **Rule type** | `sprint` adds `capacity: 6h/week` |
| **Scoring policy** | An energy plugin adds `prefer: high-energy` |
| **Data type** | `habits` adds streaks and completion stats |
| **Command** | `sprint.start`, `habit.log`. Commands are exposed to UI, CLI, API, and MCP automatically |
| **Exporter** | Placements are published to CalDAV or Google Calendar |
| **UI contribution** | A sprint board view or a prayer overlay on the day view |

A plugin can **add** rules but cannot bypass hard rules or write placements
except through the scheduler.

### 8.3 Distribution

Plugins are plain source repositories, referenced like Go modules, with no store
and no publishing step:

```yaml
# sword.yaml
plugins:
  - github.com/toyonix/sword-prayer@v0.3.1
  - ./plugins/my-local-thing
```

Installing a plugin works like `go get`, with no rebuild of Sword:

```sh
sword plugin add github.com/toyonix/sword-prayer@v0.3.1
```

1. Clone the repo at that tag into the vault's plugin folder.
2. Install its dependencies and bundle it (Sword ships the bundler).
3. Record the resolved commit hash in `sword.lock` (like `go.sum`), so the
   same vault always loads the same plugin code.
4. Load it at runtime.

Each plugin has a manifest declaring its id, version, the anchors, rules, and
commands it provides, its configuration schema, and its entry points:

- **`engine` entry**: anchor providers, rule types, scoring policies. These
  must be **pure** (no file, network, or runtime-specific APIs), because they
  run wherever the engine runs (§12.2), including a phone later.
- **`node` entry** (optional): I/O work such as fetching iqama times from a
  mosque website or talking to CalDAV. Results are handed to the engine as
  inputs. They are never fetched during scheduling.
- **`ui` entry** (optional): views, panels, and settings screens for the web UI.

Like Obsidian, a plugin runs with full trust. Installing one means trusting
its code, which is why versions are pinned and hashed.

### 8.4 Core plugins and official plugins

Following Obsidian, there are two tiers.

**Core plugins** live in the main repository, ship with Sword, and can be
turned on or off. They must be useful to everyone, whatever their culture,
religion, or job:

- **ical / caldav**: import events, export placements.
- **sun**: sunrise, sunset, solar noon.
- Later: **habits**, **sprints**, **templates** (named bundles of intentions and rules applied to a date range).

**Official plugins** are maintained by the Sword project but live in
their own repositories. They are installed with `sword plugin add`, like
any community plugin:

- **prayer**: the five prayers as anchors, with calculation method, location,
  per-prayer busy portions, and iqama times.

Nothing in the core or the core plugins may refer to a specific religion or
culture. Sword is a general tool for "time that follows things that
move". Prayer times are one important example among others, such as Shabbat and
zmanim, rotating work shifts, school timetables, tides, and medication
intervals.

### 8.5 Plugins prove the plugin API

Official plugins use only the public plugin API (`@sword/plugin-api`).
They never import core internals. `prayer` lives in its own repository
(`sword-prayer`) from day one, so the plugin path is exercised from the
start. If prayer needs something the API doesn't offer, the API is incomplete.

`@sword/plugin-api` follows the Obsidian model: it holds **types and small
helpers only**. The runtime implementation is provided by Sword when it
loads a plugin. A plugin therefore never bundles a copy of the core.

Local development across the two repos:

```yaml
# sword.yaml in a dev vault
plugins:
  - ../sword-prayer          # local path, reloaded on change
```

and in `sword-prayer/package.json`, `@sword/plugin-api` points at the
local checkout (`link:../sword/packages/plugin-api`) until the API is
stable enough to version.

## 9. Interfaces: one command layer

Every operation is a **command** with a typed schema. The HTTP API, CLI, UI,
and MCP server are all thin adapters over the same command layer. No interface
has its own scheduling logic.

### 9.1 Preview, then apply

Anything that changes the schedule is done in two steps:

```
preview(changes) → Plan        # pure, no side effects
apply(plan_id)   → Result      # applied only if the plan is still valid
```

Agents can explore freely. Humans see a diff before accepting it.

### 9.2 MCP is built in

- The MCP server is part of the Sword server process, not a separate
  script someone has to start.
- **Local**: stdio or a localhost transport, authenticated by a local token.
- **Remote**: HTTP transport with bearer tokens or OAuth, following the MCP
  authorization spec.
- Tokens are created in the app and carry **scopes**:

| Scope | Allows |
|---|---|
| `read` | Read schedule, intentions, anchors, and explanations |
| `propose` | Call `preview`; create proposals that a human approves |
| `write` | Create and edit intentions and rules; apply plans |
| `pin` | Set exact times (bypass the scheduler with explicit pins) |
| `admin` | Manage plugins, calendars, and tokens |

**Agents write rules, not times.** The MCP tools are designed around intentions
and rules (`create_intention`, `set_rules`, `preview`, `apply`, `explain`).
Setting a raw time requires the separate `pin` scope. An agent cannot place
something on top of a prayer, because it never chooses the time; the scheduler
does.

### 9.3 Natural language is a plugin

Turning "study Go after Fajr every weekday" into rules is the job of an LLM,
whether that is an external agent over MCP or an optional built-in AI plugin.
The core never needs an LLM, an API key, or a network connection.

### 9.4 Headless use

The engine must be usable without the server or UI. Given only a folder of
files, a CLI can resolve, schedule, and output the result:

```sh
sword plan                      # print the computed schedule
sword export > out.ics          # compile the horizon to iCalendar (or --out out.ics)
sword sync caldav               # push placements to Radicale, etc.
```

Someone can edit intentions in Vim, keep the folder in git, and use Sword
as a "schedule compiler" that publishes to any CalDAV server. The UI, server,
and MCP are layers on top of the same engine. They are not required to use it.

## 10. Interoperability

iCalendar/CalDAV is the **exchange format, not the database.**

- **Import**: external calendars become events, and are authoritative and
  read-only from Sword's side. They can optionally be mapped to anchors
  (e.g. the "Work" calendar provides `work`).
- **Export**: placements within the horizon are published as ordinary VEVENTs.
  Each gets a stable UID in a Sword namespace and `X-SWORD-*`
  properties, so Sword never imports its own output again.
- **Rules are never exported as RRULEs** with fixed times, because that is
  exactly what loses the behavior.
- **External edits to exported events** (open question, §17) are either
  ignored and overwritten, or interpreted as a pin override.

## 11. Storage

### 11.1 Files are the truth, the database is a cache

Storage is split by one question: **can it be recomputed?**

- **What the user meant, and what actually happened, cannot be recomputed.**
  It lives in plain **files**: intentions, rules, pins and overrides, settings,
  and completion history.
- **Everything the engine calculates can be recomputed.** It lives in an
  embedded **SQLite index**: resolved anchors, occurrences, placements, plan and
  undo history, and the search index.

The index can always be deleted and rebuilt from the files. The relational model
(intentions → occurrences → placements → anchors) lives in SQL, where it can be
queried and joined. Files refer to each other by id, and the indexer turns
those references into foreign keys.

### 11.2 Vault layout

```
my-calendar/
├── sword.yaml             # settings, plugins, global rules, day.start
├── sword.lock             # exact plugin versions (written by the app)
├── tasks/
│   ├── study-go.md        # one file per task; the file name is its id
│   └── write-report.md    # subfolders are fine
├── log/
│   └── 2026-10.jsonl      # done / missed, one line each, append-only
└── .sword/                # derived, safe to delete, not synced or versioned
    ├── index.db
    └── plugins/
```

"Intention" is the internal word; on disk they are tasks. A task file without
rules is simply in the inbox, so there is no inbox folder. Calendar feeds are
settings in `sword.yaml`; their events are cached in the index because they can
always be fetched again. Passwords and tokens never go in the vault, since it
may be synced or versioned; they go in the system keyring.

Plugins may add their own folders (e.g. `sprints/`) with the same rule: user
intent goes in files, and computed state goes in the index.

### 11.3 Task files

Each task is a Markdown file with YAML frontmatter, the same convention
Obsidian uses:

`tasks/Study Go.md`:

```markdown
---
duration: 45m
repeat: daily
after: prayer.fajr
before: work.start or 08:00
pins:
  - 2026-10-26 07:30      # an occurrence moved by hand
tags:
  - learning
---

Working through chapter 7. Free-form notes go here.
```

The properties are **Obsidian properties**. Obsidian supports flat properties
of a few types (text, list, number, checkbox, date, date and time) and gives
each property name one type across the vault; nested values only show in
source mode. So every Sword property is flat and always has the same type:

| Type | Properties |
|---|---|
| Text | `duration`, `at`, `after`, `before`, `within`, `prefer`, `repeat`, `title`, `id` |
| List | `repeat_on`, `avoid`, `pins`, `tags` |
| Number | `priority`, `repeat_every`, `repeat_day` |
| Date | `date`, `repeat_since`, and `deadline` (which may also be a date and time) |

- **The file name is the task.** `Study Go.md` is the task "Study Go", in any
  language. `title` is only needed for a different display name, and `id` to
  keep a stable id when renaming the file.
- **Other properties are left alone**, so Obsidian's own (`aliases`,
  `cssclasses`) and yours can live in the same note. Only near misses get a
  warning, like `befor` ("did you mean before?"), so typos are still caught.
- A list with one value may be written as plain text (`tags: learning`).

The frontmatter schema **is** the rule format. The same schema (as JSON Schema)
defines the inputs of the API and the MCP tools, so a rule looks the same
whether it is typed in Vim or Obsidian, sent over HTTP, or produced by an agent.

Pins live in the task file because they are decisions about that task: each is
the logical date of the occurrence and a local time. Pins on past dates are
removed once their day has passed, so the list doesn't grow.

### 11.4 The log

What happened is appended to `log/YYYY-MM.jsonl`, one line per event:

```json
{"at":"2026-10-25T06:45:00Z","occurrence":"study@2026-10-25","state":"done","start":"2026-10-25T03:21:00Z","end":"2026-10-25T04:06:00Z"}
```

It is not kept in the task files: a daily task would collect hundreds of lines
a year, and appending one line at a time means two devices syncing almost
never conflict. For each occurrence, the last line wins.

### 11.5 Write path and consistency

- Every command writes the file first, then updates the index.
- If the process crashes between the two steps, the index is reconciled from
  the files on the next start.
- The vault is watched. External edits (an editor, `git pull`, a sync tool)
  trigger re-indexing of the changed files.
- An invalid file (bad YAML, unknown anchor) is reported as an error on that
  intention and excluded from scheduling. It never crashes the engine or blocks
  other intentions.
- If the index is lost, pins and history survive because they are in files.
  Flexible placements are recomputed and may land slightly differently than
  before.

## 12. Deployment and platforms

### 12.1 Topology: one node, many clients

A **node** is a running Sword instance that owns one vault. It runs the
engine, the index, the HTTP API, the MCP endpoint, and serves the web UI. It is
the same program whether it runs on a home server, a VPS, or the user's laptop.

Every other client (browser, desktop app, phone app, AI agent) talks to that
node. Only the node writes to the vault (apart from external edits, §11.5) and
only the node pushes to external calendars. This avoids sync conflicts and
duplicate exports, and keeps tokens and permissions in one place.

### 12.2 Keep the engine embeddable

The engine (time model, rules, scheduler) is a **pure library with no I/O**. It
takes resolved inputs and returns a plan. It does not read files, open
databases, or make network calls. The node and CLI wrap it with I/O.

This one rule keeps every later platform option open. The same engine can be
embedded in a desktop app or compiled into a phone app, without a rewrite.

### 12.3 Platform path

| Stage | Desktop | Phone | Engine runs on |
|---|---|---|---|
| **1. Web (v1)** | Browser → node | Browser → node; installable as a PWA | The node |
| **2. App shells** | Desktop app that bundles a local node and the same web UI | Native shell around the same web UI (native notifications, home-screen widget), talking to a remote node | The node |
| **3. Offline phone** | — | Engine embedded in the phone app on a synced vault copy | Each device |

- Every stage reuses the web UI. No platform gets a separate UI codebase.
- Stage 3 is the "every device has its own copy" model. It needs no design
  change because files and a deterministic engine already allow it. It only
  adds conflict handling and a rule for which device exports.
- **Reminders in v1** come for free through interop: placements exported to
  CalDAV (e.g. Radicale) show up in the phone's native calendar app with its
  native notifications. Web push from the node is an addition, not a
  requirement.

## 13. Technology

### 13.1 Language: TypeScript everywhere

The engine, plugins, server, and UI are all TypeScript (strict mode).

- **One language per plugin.** A plugin's engine, I/O, and UI parts live in one
  package and one build. With a Go core, every plugin with UI would need both Go
  and TypeScript.
- **Runtime loading.** Plugins are added without rebuilding Sword. A Go
  core would need a recompile per plugin (the dwm/xcaddy model), which suits a
  single tinkerer but not an ecosystem, a desktop app, or a phone app.
- **The engine runs everywhere.** The same engine and plugin code runs on the
  node, in the browser (instant "what if" previews), and later inside a phone
  app (stage 3), without a separate mobile build.
- **The ecosystem is familiar.** Obsidian plugin authors and AI agents already
  write TypeScript fluently, and the reference MCP SDK is TypeScript.

### 13.2 Runtime: Node.js (LTS)

Node is the most stable, widely supported choice. Deno was ruled out after
Cloudflare acquired it (October 2026) with official runtime development ending
after a year.

Runtime-specific APIs (`node:fs`, SQLite, sockets) are only allowed in the I/O
packages (`vault`, `index`, `server`, `cli`) and plugin `node` entries. The
`engine` package and plugin `engine` entries use only standard JavaScript, so
switching or adding runtimes later touches only the I/O layer.

### 13.3 Stack

| Concern | Choice |
|---|---|
| Monorepo / packages | pnpm workspaces |
| Schemas (files, API, MCP, UI types) | Zod, exported to JSON Schema for MCP and API docs |
| Time and time zones | Temporal API (polyfill until native everywhere) |
| Recurrence | `rrule` (to be validated against logical-day and DST edge cases) |
| Prayer times | `adhan` (adhan-js) |
| iCalendar / CalDAV | `ical.js`, `tsdav` |
| Frontmatter | `yaml` |
| File watching | `chokidar` |
| SQLite | `node:sqlite` if stable on our target LTS, else `better-sqlite3`, behind the `index` package |
| HTTP server | Hono (runtime-agnostic) |
| MCP | `@modelcontextprotocol/sdk` (stdio + streamable HTTP) |
| Web UI | React, Vite, TanStack Query; custom day/week time grid |
| Plugin bundling | esbuild |
| Tests | Vitest |

### 13.4 Repository layout

```
packages/
  engine/      pure: time model, rules, scheduler (standard JS only)
  schema/      Zod schemas shared by everything
  vault/       files ↔ model, watcher
  index/       SQLite
  commands/    command layer
  server/      HTTP API + MCP + serves web UI
  cli/         plan · export · sync · serve · plugin add
  web/         React app
  plugin-api/  public API that every plugin builds against
plugins/
  ical/  sun/  core plugins, shipped with Sword
```

Official plugins live in sibling repositories, e.g. `sword-prayer`.

### 13.5 Distribution

- **v1**: an npm package (`npx sword serve`) and a Docker image for home
  servers.
- **Later**: a single executable, and app shells for stage 2 (§12.3). The
  desktop and mobile shell technologies are decided at that stage.

### 13.6 Licensing

Everything is **MIT**: the core, `@sword/plugin-api`, the core plugins, and
`sword-prayer`. Plugins may use any license.

## 14. Principles

1. **Intent is separate from placement.** Definitions have no start or end time.
2. **Time is relational.** Fixed times are just constant anchors.
3. **Hard rules are never violated.** It is better to leave something unscheduled, with a reason, than to place it wrongly.
4. **The scheduler is deterministic and explainable.** AI proposes; the engine decides.
5. **One command layer.** UI, CLI, API, plugins, and MCP share the same operations and rules.
6. **The core is minimal.** Prayer, sprints, habits, and AI are plugins.
7. **The schedule is stable.** Valid placements don't move without cause, and every move is explained and undoable.
8. **Local-first.** Everything works offline, without an LLM or a cloud account.
9. **Interop is explicit.** Standard formats in and out, without pretending they can carry the rules.
10. **Plain and portable data.** Definitions should be human-readable and diffable.

## 15. MVP scope

The first version must prove one claim: **rule-based placement beats fixed
recurring blocks** for a day that moves.

In scope:

- Core time model: anchors with windows and busy portions, logical day, offsets
- Intentions with duration, `at`, `window`, `avoid`, `deadline`, `repeat`, `prefer`, `priority`
- Global hard rules
- Greedy deterministic scheduler with stability and explanations
- Placement lifecycle including pin, done, and missed
- Core plugins: `ical` (import + export feed), `sun`
- Official plugin: `prayer`, installed through the normal plugin path
- Command layer with CLI and MCP (local + token auth with scopes)
- Minimal web UI: day/week view, inbox, Missed section, intention editor, "why?" panel

Not in scope yet: sprints, habits, templates, two-way Google sync, runtime
plugin loading, a built-in LLM, multi-user use, constraint-solver optimization,
desktop and mobile apps (see §12.3).

## 16. Acceptance scenario

The engine is "working" when this passes, with identical results through the
CLI, the API, and MCP.

The engine's own tests use **synthetic anchors** (a test provider with
hand-written times) so the core never depends on any plugin. The scenario below
is the end-to-end test for the `prayer` plugin. It was chosen because it is a
demanding case: anchors that move daily, strict exclusions, and tight windows.

**Setup** (location with real prayer times, 7-day horizon, `day.start = prayer.fajr.start`)

- Global rule: never overlap `tag:prayer`. Each prayer is busy for 20 minutes from its start.
- `work`: weekdays, 09:00–17:00.
- *Morning Quran*: `at: prayer.fajr.busy.end + 5m`, 20m, daily.
- *Study Go*: 45m, daily, `after: prayer.fajr`, `before: work.start`, `prefer: earliest`.
- *Write report*: 30m, one-off, `before: prayer.dhuhr`, `deadline: day 3`.
- *Walk*: 30m, daily, `after: prayer.asr`, `before: prayer.maghrib`.

**Expectations**

1. Morning Quran's time moves daily with Fajr, always exactly 5 minutes after the prayer's busy period ends.
2. Study Go goes right after Morning Quran on every weekday and never touches a prayer.
3. Saturday has no `work`, so Study Go is unplaced with the reason "anchor `work` is not available", because its rule has no fallback.
4. A meeting is added on day 2 inside Study Go's slot. Only that day's Study Go moves, and the plan explains why.
5. The user pins Walk at 17:10 on day 4. Later the Asr anchor moves; the pin does not move and a conflict is reported if it now overlaps.
6. Day 5's Fajr-to-work gap is shrunk to 30 minutes (test fixture). Study Go is unplaced on that day and nothing overlaps.
7. An agent over MCP with only `propose` scope asks to "schedule Write report at 12:00". It cannot set the time. It can preview a plan, and the plan respects every rule.
8. Running the scheduler twice with no input change produces an empty diff.

## 17. Open questions

- **External edits** to exported events: ignore, treat as a pin, or ask?
- **Partial fits and splitting**: can a 90m task be split into 2×45m? (Probably an opt-in rule `split: 45m` later.)
