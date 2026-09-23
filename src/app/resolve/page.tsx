import { EmptyState, ErrorNotice } from "@/components/notices";
import { ResourceTable } from "@/components/resource-table";
import { getIndexCoreClient } from "@/lib/indexcore/server";
import { load } from "@/lib/load";
import { boolParam, firstParam, type SearchParams } from "@/lib/query";

export const dynamic = "force-dynamic";

export default async function ResolvePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const root = firstParam(sp.root);
  const path = firstParam(sp.path);
  const includeRemoved = boolParam(sp.include_removed);
  const includeDeprecatedRoot = boolParam(sp.include_deprecated_root);
  const includeDeletedRoot = boolParam(sp.include_deleted_root);

  const client = getIndexCoreClient();
  const rootsResult = await load(() =>
    client.listRoots({ include_deprecated: true, include_deleted: true }),
  );

  const resolution =
    root && path
      ? await load(() =>
          client.resolvePath(root, {
            path,
            include_removed: includeRemoved,
            include_deprecated_root: includeDeprecatedRoot,
            include_deleted_root: includeDeletedRoot,
          }),
        )
      : undefined;

  return (
    <>
      <h1>Resolve path</h1>
      <p className="note">
        Q5 <code>resolve_path</code>. Overlapping canonical resources are all returned; the
        consumer never guesses which match is “correct”.
      </p>

      <form className="picker" method="get" action="/resolve">
        <label>
          Root{" "}
          <select name="root" defaultValue={root ?? ""}>
            <option value="">— select a root —</option>
            {rootsResult.ok
              ? rootsResult.value.map((option) => (
                  <option key={option.root_id} value={option.root_id}>
                    {option.root_id} ({option.lifecycle_state})
                  </option>
                ))
              : null}
          </select>
        </label>
        <label>
          Path <input type="text" name="path" defaultValue={path ?? ""} placeholder="/docs/a.txt" />
        </label>
        <label>
          <input type="checkbox" name="include_removed" value="1" defaultChecked={includeRemoved} />{" "}
          include removed
        </label>
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
        <button type="submit">Resolve</button>
      </form>

      {!rootsResult.ok ? <ErrorNotice failure={rootsResult} /> : null}

      {!root || !path ? (
        <EmptyState>Choose a root and enter a path to resolve.</EmptyState>
      ) : resolution && !resolution.ok ? (
        <ErrorNotice failure={resolution} />
      ) : resolution && resolution.ok ? (
        <>
          {resolution.value.ambiguous ? (
            <div className="alert warn" role="alert">
              <strong>Ambiguous path.</strong> {resolution.value.matches.length} canonical
              resources match this path. The consumer does not choose one.
            </div>
          ) : null}
          {resolution.value.matches.length === 0 ? (
            <EmptyState>No resource matches this path.</EmptyState>
          ) : (
            <ResourceTable
              rootId={root}
              resources={resolution.value.matches}
              linkQuery={{
                include_removed: includeRemoved ? true : undefined,
                include_deprecated_root: includeDeprecatedRoot ? true : undefined,
                include_deleted_root: includeDeletedRoot ? true : undefined,
              }}
            />
          )}
        </>
      ) : null}
    </>
  );
}