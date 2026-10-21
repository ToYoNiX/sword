/** The input as a whole is unusable (bad time zone, bad horizon, …). */
export class EngineInputError extends Error {
  override name = 'EngineInputError';
}

/** A single value (duration, time expression, date, …) could not be parsed. */
export class ParseError extends Error {
  override name = 'ParseError';
}
