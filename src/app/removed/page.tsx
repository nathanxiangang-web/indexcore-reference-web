import { RootPicker, Pagination } from "@/components/controls";
import { EmptyState, ErrorNotice } from "@/components/notices";
import { ResourceTable } from "@/components/resource-table";
import { getIndexCoreClient } from "@/lib/indexcore/server";
import { load } from "@/lib/load";
import { buildHref, firstParam, intParam, type SearchParams } from "@/lib/query";

export const dynamic = "force-dynamic";

export default async function RemovedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const root = firstParam(sp.root);
  const cursor = firstParam(sp.cursor);
  const limit = intParam(sp.limit, 50);

  const client = getIndexCoreClient();
  const rootsResult = await load(() =>
    client.listRoots({ include_deprecated: true, include_deleted: true }),
  );

  const pageResult = root
    ? await load(() => client.listRemovedResources(root, { cursor, limit }))
    : undefined;

  const resetHref = buildHref("/removed", { root, limit });

  return (
    <>
      <h1>Removed resources</h1>
      <p className="note">
        Q7 <code>list_removed</code>. Whole-root tombstones, generation-bound pagination.
      </p>

      {rootsResult.ok ? (
        <RootPicker action="/removed" roots={rootsResult.value} selected={root} />
      ) : (
        <ErrorNotice failure={rootsResult} />
      )}

      {!root ? (
        <EmptyState>Select a root to browse its removed resources.</EmptyState>
      ) : pageResult && !pageResult.ok ? (
        <ErrorNotice failure={pageResult} resetHref={resetHref} />
      ) : pageResult && pageResult.ok ? (
        pageResult.value.items.length === 0 ? (
          <EmptyState>No removed resources in this root.</EmptyState>
        ) : (
          <ResourceTable rootId={root} resources={pageResult.value.items} />
        )
      ) : null}

      {root && pageResult && pageResult.ok ? (
        <Pagination
          basePath="/removed"
          params={{ root, limit: String(limit) }}
          nextCursor={pageResult.value.next_cursor}
          hasCursor={Boolean(cursor)}
        />
      ) : null}
    </>
  );
}