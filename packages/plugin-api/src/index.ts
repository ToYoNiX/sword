/*
 * The types a Sword plugin is written against. Types only: everything a
 * plugin uses at run time is passed in by Sword when it calls the plugin, so
 * a plugin never bundles any of Sword. See docs/design.md §8.
 *
 *   export default {
 *     id: 'prayer',
 *     settings(raw) { ... },
 *     anchors({ dates, timeZone, location, settings }) { ... },
 *   } satisfies Plugin<PrayerSettings>;
 *
 * A plugin's repository has a manifest.json and a main.js at its root:
 * main.js is the plugin bundled into one ES module, so it loads anywhere
 * without npm (a phone, a browser).
 */

/** The plugin's manifest.json. */
export interface Manifest {
  /** Lowercase letters, digits and "_"; its anchors are named "<id>.<name>". */
  id: string;
  name: string;
  version: string;
}

/** What a plugin provides. Each part is optional; Sword calls what is there. */
export interface Plugin<Settings = unknown> {
  /** The same id as in manifest.json. */
  id: string;
  /**
   * Checks the plugin's section of sword.yaml (the value under its id, or
   * undefined when there is none) and returns the settings it will be given.
   */
  settings?(raw: unknown): SettingsResult<Settings>;
  /** Anchors for the given dates. Pure: no files, network or clock. */
  anchors?(context: AnchorContext<Settings>): Anchor[];
}

export type SettingsResult<Settings> = { ok: true; value: Settings } | { ok: false; errors: string[] };

export interface AnchorContext<Settings = unknown> {
  /** Civil dates, "YYYY-MM-DD", in the vault's time zone. */
  dates: string[];
  /** IANA time zone, e.g. "Africa/Cairo". */
  timeZone: string;
  /** From sword.yaml; undefined if it isn't set. */
  location: Location | undefined;
  settings: Settings;
}

export interface Location {
  latitude: number;
  longitude: number;
}

/** One anchor on one civil date. Instants are ISO strings with an offset, e.g. "2026-10-25T02:36:00Z". */
export interface Anchor {
  /** "<plugin id>.<name>", e.g. "prayer.asr". */
  id: string;
  date: string;
  start: string;
  /** Defaults to start: a point in time. */
  end?: string;
  /** The parts of the window that occupy the user's time; Sword keeps them clear. */
  busy?: { start: string; end: string }[];
  tags?: string[];
}
