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
  const [rootResult, statusResult, pageResult] = await Promise.all([
    load(() => client.getRoot(rootId, readOptions)),
    load(() => client.getRootStatus(rootId, readOptions)),
    load(() =>
      client.listResources(rootId, {
        parent_id: parent,
        cursor,
        limit,
        include_removed: includeRemoved,
      }),
    ),
  ]);

  // Bounded walk up the parent chain for breadcrumbs (Q3 get_resource).
  const trail: Resource[] = [];
  let ancestor = parent;
  for (let depth = 0; ancestor && depth < 32; depth += 1) {
    const id: string = ancestor;
    const found = await load(() => client.getResource(id, { include_removed: true }));
    if (!found.ok) break;
    trail.unshift(found.value);
    ancestor = found.value.parent_resource_id ?? undefined;
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
      <p className="hint">Q9 get_root_status is reflected in the summary above.</p>

      <h2>Hierarchy (Q4 list_resources)</h2>
      <Breadcrumbs rootId={rootId} trail={trail} />
      {parent ? (
        <p className="hint">
          Showing children of <span className="mono">{parent}</span> ·{" "}
          <Link href={resetHref}>back to root level</Link>
        </p>
      ) : (
        <p className="hint">Showing root-level children. Directories link to their children.</p>
      )}

      {!pageResult.ok ? (
        <ErrorNotice failure={pageResult} resetHref={resetHref} />
      ) : pageResult.value.items.length === 0 ? (
        <EmptyState>No child resources here.</EmptyState>
      ) : (
        <ResourceTable rootId={rootId} resources={pageResult.value.items} />
      )}

      {pageResult.ok ? (
        <Pagination
          basePath={basePath}
          params={params0}
          nextCursor={pageResult.value.next_cursor}
          hasCursor={Boolean(cursor)}
        />
      ) : null}
    </>
  );
}