// Consumer-owned transport DTOs for the IndexCore read-only /v1 HTTP contract.
//
// These are intentionally NOT a copy of the IndexCore Go domain/query structs.
// They describe only what crosses the wire, using the exact JSON field names the
// frozen Query Contract emits. The consumer maps them into whatever shape the UI
// wants; it never treats them as shared internal models.

// The three closed enums are declared as runtime arrays (single source of truth)
// so the client can actually validate them instead of merely casting. A value
// outside the frozen set is a contract violation and must fail as
// `malformed_response`.

/** Root lifecycle state (IndexCore doc A T1). */
export const ROOT_LIFECYCLE_STATES = ["NEW", "ACTIVE", "DEPRECATED", "DELETED"] as const;
export type RootLifecycleState = (typeof ROOT_LIFECYCLE_STATES)[number];

/** The only consumer-visible presence signal (IndexCore doc C V1/V2). */
export const RESOURCE_PRESENCES = ["PRESENT", "REMOVED"] as const;
export type ResourcePresence = (typeof RESOURCE_PRESENCES)[number];

/** The closed set of seven canonical journal event types (IndexCore doc D U3). */
export const EVENT_TYPES = [
  "resource-added",
  "resource-updated",
  "resource-renamed",
  "resource-moved",
  "resource-removed",
  "root-deprecated",
  "root-deleted",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Q2/Q1 — one root as exposed by `GET /v1/roots` and `GET /v1/roots/{id}`. */
export interface Root {
  root_id: string;
  lifecycle_state: RootLifecycleState;
  current_generation: number;
  created_at: string;
}

/** Q9 — `GET /v1/roots/{id}/status`. */
export interface RootStatus {
  root_id: string;
  lifecycle_state: RootLifecycleState;
  current_generation: number;
  last_applied_admission_seq?: number | null;
}

/** Q3/Q4/Q5/Q6/Q7 — one canonical resource. */
export interface Resource {
  resource_id: string;
  root_id: string;
  canonical_path?: string | null;
  parent_resource_id?: string | null;
  name?: string | null;
  is_dir?: boolean | null;
  size?: number | null;
  mtime?: string | null;
  content_hash?: string | null;
  content_type?: string | null;
  resource_presence: ResourcePresence;
  introduced_at_generation: number;
  last_confirmed_generation: number;
}

/** Q8 — one per-root journal event. There is no global cross-root order. */
export interface JournalEvent {
  event_seq: number;
  generation_number: number;
  intra_generation_seq: number;
  event_type: EventType;
  resource_id?: string | null;
  payload?: string;
  committed_at: string;
}

/**
 * One generation-bound page. `next_cursor` is opaque; the consumer must round-trip
 * it verbatim. When absent it is normalized to `null`.
 */
export interface ResourcePage {
  items: Resource[];
  next_cursor: string | null;
}

/** Q5 — explicit path resolution. Ambiguity is surfaced, never guessed away. */
export interface PathResolution {
  matches: Resource[];
  ambiguous: boolean;
}

/** `GET /healthz`. */
export interface HealthStatus {
  status: string;
  version?: string;
}

/** `GET /readyz` (ready body only; failures are surfaced as errors). */
export interface ReadyStatus {
  status: string;
  schema_applied?: number;
  reason?: string;
}

/** Independent frozen visibility opt-ins (IndexCore doc C R3-7). */
export interface ReadOptions {
  include_removed?: boolean;
  include_deprecated_root?: boolean;
  include_deleted_root?: boolean;
}

/** Q2 list_roots visibility opt-ins. */
export interface ListRootsQuery {
  include_deprecated?: boolean;
  include_deleted?: boolean;
}

/** Shared generation-bound pagination inputs. */
export interface PageQuery extends ReadOptions {
  cursor?: string;
  limit?: number;
}

/** Q4 list_resources hierarchy inputs. */
export interface ListResourcesQuery extends PageQuery {
  parent_id?: string;
}

/** Q5 resolve_path inputs. */
export interface ResolveQuery extends ReadOptions {
  path: string;
}

/** Q8 read_journal inputs. */
export interface JournalQuery {
  after_seq?: number;
  limit?: number;
}