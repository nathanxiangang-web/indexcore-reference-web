export type ParamValue = string | number | boolean | undefined | null;

/**
 * Visibility opt-ins (include_removed / include_deprecated_root /
 * include_deleted_root) that must survive navigation between pages.
 */
export type LinkQuery = Record<string, string | number | boolean | undefined>;

/** Builds a URL for one of this Web app's own routes (never an IndexCore URL). */
export function buildHref(path: string, params: Record<string, ParamValue> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  }
  const qs = search.toString();
  return qs.length > 0 ? `${path}?${qs}` : path;
}

/** Next.js may hand a search param as `string | string[]`; take the first value. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Parses a positive integer search param, falling back to a default. */
export function intParam(
  value: string | string[] | undefined,
  fallback: number,
): number {
  const raw = firstParam(value);
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** True when a search param is the conventional `1`/`true` opt-in. */
export function boolParam(value: string | string[] | undefined): boolean {
  const raw = firstParam(value);
  return raw === "1" || raw === "true";
}

export type SearchParams = Record<string, string | string[] | undefined>;

/** Flattens Next.js search params into a plain string map for link building. */
export function paramMap(params: SearchParams): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] = firstParam(value);
  }
  return out;
}