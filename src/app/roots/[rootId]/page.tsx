import Link from "next/link";

import { Breadcrumbs, Pagination } from "@/components/controls";
import { EmptyState, ErrorNotice } from "@/components/notices";
import { ResourceTable } from "@/components/resource-table";
import { getIndexCoreClient } from "@/lib/indexcore/server";
import type { Resource } from "@/lib/indexcore/types";
import { load } from "@/lib/load";
import {
  boolParam,
  buildHref,
  firstParam,
  intParam,
  paramMap,
  type SearchParams,
} from "@/lib/query";

export const dynamic = "force-dynamic";

type View = "hierarchy" | "active";

export default async function RootDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ rootId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { rootId } = await params;
  const sp = await searchParams;
  const basePath = `/roots/${encodeURIComponent(rootId)}`;

  const view: View = firstParam(sp.view) === "active" ? "active" : "hierarchy";
  const parent = firstParam(sp.parent);
  const cursor = firstParam(sp.cursor);
  const limit = intParam(sp.limit, 50);
  const includeRemoved = boolParam(sp.include_removed);
  const includeDeprecatedRoot = boolParam(sp.include_deprecated_root);
  const includeDeletedRoot = boolParam(sp.include_deleted_root);

  const readOptions = {
    include_removed: includeRemoved,
    include_deprecated_root: includeDeprecatedRoot,
    include_deleted_root: includeDeletedRoot,
  };

  const client = getIndexCoreClient();
  const [rootResult, statusResult] = await Promise.all([
    load(() => client.getRoot(rootId, readOptions)),
    load(() => client.getRootStatus(rootId, readOptions)),
  ]);

  // Q4 list_resources expresses hierarchy; Q6 list_active_resources is a
  // whole-root listing and is a distinct call with distinct semantics.
  const listResult =
    view === "active"
      ? await load(() => client.listActiveResources(rootId, { cursor, limit }))
      : await load(() =>
          client.listResources(rootId, {
            parent_id: parent,
            cursor,
            limit,
            include_removed: includeRemoved,
            include_deprecated_root: includeDeprecatedRoot,
            include_deleted_root: includeDeletedRoot,
          }),
        );

  // Bounded walk up the parent chain for breadcrumbs (Q3 get_resource). Root
  // visibility opt-ins are threaded through so a deprecated/deleted root stays
  // navigable end to end.
  const trail: Resource[] = [];
  if (view === "hierarchy") {
    let ancestor = parent;
    for (let depth = 0; ancestor && depth < 32; depth += 1) {
      const id: string = ancestor;
      const found = await load(() =>
        client.getResource(id, { ...readOptions, include_removed: true }),
      );
      if (!found.ok) break;
      trail.unshift(found.value);
      ancestor = found.value.parent_resource_id ?? undefined;
    }
  }

  const params0 = paramMap(sp);
  const link = (overrides: Record<string, string | boolean | number | undefined>) =>
    buildHref(basePath, { ...params0, ...overrides });
  const resetHref = link({ cursor: undefined });

  return (
    <>
      <h1>Root</h1>
      <p className="mono">{rootId}</p>

      {!rootResult.ok ? <ErrorNotice failure={rootResult} /> : null}

      {rootResult.ok ? (
        <dl className="kv">
          <dt>lifecycle</dt>
          <dd>{rootResult.value.lifecycle_state}</dd>
          <dt>current generation</dt>
          <dd className="mono">{rootResult.value.current_generation}</dd>
          <dt>created_at</dt>
          <dd className="mono">{rootResult.value.created_at}</dd>
          <dt>last applied admission seq</dt>
          <dd className="mono">
            {statusResult.ok
              ? (statusResult.value.last_applied_admission_seq ?? "—")
              : "—"}
          </dd>
        </dl>
      ) : null}

      <p className="picker">
        <Link href={link({ view: undefined, parent: undefined, cursor: undefined })}>
          {view === "hierarchy" ? "• Hierarchy (Q4)" : "Hierarchy (Q4)"}
        </Link>
        <Link href={link({ view: "active", parent: undefined, cursor: undefined })}>
          {view === "active" ? "• Active resources (Q6)" : "Active resources (Q6)"}
        </Link>
      </p>

      <p className="picker">
        <Link href={link({ include_removed: includeRemoved ? undefined : true })}>
          {includeRemoved ? "Hide" : "Show"} removed resources
        </Link>
        <Link
          href={link({ include_deprecated_root: includeDeprecatedRoot ? undefined : true })}
        >
          {includeDeprecatedRoot ? "Hide" : "Show"} deprecated root
        </Link>
        <Link href={link({ include_deleted_root: includeDeletedRoot ? undefined : true })}>
          {includeDeletedRoot ? "Hide" : "Show"} deleted root
        </Link>
        <Link href={`/removed?root=${encodeURIComponent(rootId)}`}>Removed view</Link>
        <Link href={`/journal?root=${encodeURIComponent(rootId)}`}>Journal</Link>
      </p>
      <p className="hint">
        Q9 get_root_status is reflected in the summary above. Root visibility is threaded
        through Q4 and breadcrumbs.
      </p>

      {view === "active" ? (
        <>
          <h2>Active resources (Q6 list_active_resources)</h2>
          <p className="hint">
            Whole-root active listing (not filtered by parent), generation-bound pagination.
          </p>
        </>
      ) : (
        <>
          <h2>Hierarchy (Q4 list_resources)</h2>
          <Breadcrumbs rootId={rootId} trail={trail} />
          {parent ? (
            <p className="hint">
              Showing children of <span className="mono">{parent}</span> ·{" "}
              <Link href={resetHref}>back to root level</Link>
            </p>
          ) : (
            <p className="hint">
              Showing root-level children. Directories link to their children.
            </p>
          )}
        </>
      )}

      {!listResult.ok ? (
        <ErrorNotice failure={listResult} resetHref={resetHref} />
      ) : listResult.value.items.length === 0 ? (
        <EmptyState>
          {view === "active" ? "No active resources in this root." : "No child resources here."}
        </EmptyState>
      ) : (
        <ResourceTable rootId={rootId} resources={listResult.value.items} />
      )}

      {listResult.ok ? (
        <Pagination
          basePath={basePath}
          params={params0}
          nextCursor={listResult.value.next_cursor}
          hasCursor={Boolean(cursor)}
        />
      ) : null}
    </>
  );
}
