// Structured errors for the theme-lab.
//
// Every agent-facing failure carries a stable machine code so an LLM can branch
// on the failure instead of parsing prose.

export class ThemeLabError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "ThemeLabError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toJSON() {
    return {code: this.code, message: this.message, ...(this.details ? {details: this.details} : {})};
  }
}

export function fail(code, message, details) {
  throw new ThemeLabError(code, message, details);
}

export function errorPayload(error) {
  if (error instanceof ThemeLabError) return {ok: false, error: error.toJSON()};
  return {ok: false, error: {code: "internal_error", message: String(error?.message ?? error)}};
}

export function assertInteger(value, code, label) {
  if (!Number.isSafeInteger(value)) fail(code, `${label} must be an integer`, {value});
  return value;
}

export function assertNonEmptyString(value, code, label) {
  if (typeof value !== "string" || value.length === 0) fail(code, `${label} must be a non-empty string`);
  return value;
}
