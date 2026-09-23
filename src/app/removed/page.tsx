import { Pagination, RootPicker } from "@/components/controls";
import { EmptyState, ErrorNotice } from "@/components/notices";
import { ResourceTable } from "@/components/resource-table";
import { getIndexCoreClient } from "@/lib/indexcore/server";
import { load } from "@/lib/load";
import { boolParam, buildHref, firstParam, intParam, type SearchParams } from "@/lib/query";

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
  const includeDeprecatedRoot = boolParam(sp.include_deprecated_root);
  const includeDeletedRoot = boolParam(sp.include_deleted_root);

  const client = getIndexCoreClient();
  const rootsResult = await load(() =>
    client.listRoots({ include_deprecated: true, include_deleted: true }),
  );

  const pageResult = root
    ? await load(() => client.listRemovedResources(root, { cursor, limit }))
    : undefined;

  // Root visibility must survive into Q3 resource detail: a tombstone inside a
  // DEPRECATED/DELETED root still needs the matching root opt-in to be visible.
  const rootVisibility = {
    include_deprecated_root: includeDeprecatedRoot ? true : undefined,
    include_deleted_root: includeDeletedRoot ? true : undefined,
  };
  const pageParams: Record<string, string | undefined> = {
    root,
    limit: String(limit),
    include_deprecated_root: includeDeprecatedRoot ? "1" : undefined,
    include_deleted_root: includeDeletedRoot ? "1" : undefined,
  };
  const resetHref = buildHref("/removed", pageParams);

  return (
    <>
      <h1>Removed resources</h1>
      <p className="note">
        Q7 <code>list_removed</code>. Whole-root tombstones, generation-bound pagination. Root
        visibility below is carried into resource detail, so a tombstone inside a
        DEPRECATED/DELETED root stays reachable.
      </p>

      {rootsResult.ok ? (
        <RootPicker action="/removed" roots={rootsResult.value} selected={root}>
          <label>
            <input
              type="checkbox"
              name="include_deprecated_root"
              value="1"
              defaultChecked={includeDeprecatedRoot}
            />{" "}
            include deprecated root
          </label>
          <label>
            <input
              type="checkbox"
              name="include_deleted_root"
              value="1"
              defaultChecked={includeDeletedRoot}
            />{" "}
            include deleted root
          </label>
        </RootPicker>
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
          <ResourceTable
            rootId={root}
            resources={pageResult.value.items}
            linkQuery={{ include_removed: true, ...rootVisibility }}
          />
        )
      ) : null}

      {root && pageResult && pageResult.ok ? (
        <Pagination
          basePath="/removed"
          params={pageParams}
          nextCursor={pageResult.value.next_cursor}
          hasCursor={Boolean(cursor)}
        />
      ) : null}
    </>
  );
}
