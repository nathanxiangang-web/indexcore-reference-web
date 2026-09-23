import Link from "next/link";

import { EmptyState, ErrorNotice } from "@/components/notices";
import { getIndexCoreClient } from "@/lib/indexcore/server";
import { load } from "@/lib/load";
import { boolParam, buildHref, type SearchParams } from "@/lib/query";

export const dynamic = "force-dynamic";

export default async function RootsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const includeDeprecated = boolParam(sp.include_deprecated);
  const includeDeleted = boolParam(sp.include_deleted);

  const client = getIndexCoreClient();
  const result = await load(() =>
    client.listRoots({
      include_deprecated: includeDeprecated,
      include_deleted: includeDeleted,
    }),
  );

  const toggleHref = (key: "include_deprecated" | "include_deleted"): string => {
    const next = {
      include_deprecated: includeDeprecated,
      include_deleted: includeDeleted,
    };
    next[key] = !next[key];
    return buildHref("/roots", {
      include_deprecated: next.include_deprecated ? true : undefined,
      include_deleted: next.include_deleted ? true : undefined,
    });
  };

  return (
    <>
      <h1>Roots</h1>
      <p className="note">
        Q2 <code>list_roots</code>. Only ACTIVE/NEW roots are visible by default; DEPRECATED
        and DELETED roots must be requested explicitly.
      </p>

      <p className="picker">
        <Link href={toggleHref("include_deprecated")}>
          {includeDeprecated ? "Hide" : "Show"} deprecated roots
        </Link>
        <Link href={toggleHref("include_deleted")}>
          {includeDeleted ? "Hide" : "Show"} deleted roots
        </Link>
      </p>

      {!result.ok ? (
        <ErrorNotice failure={result} />
      ) : result.value.length === 0 ? (
        <EmptyState>No visible roots.</EmptyState>
      ) : (
        <table>
          <thead>
            <tr>
              <th>root_id</th>
              <th>lifecycle</th>
              <th>generation</th>
              <th>created_at</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {result.value.map((root) => (
              <tr key={root.root_id}>
                <td className="mono">{root.root_id}</td>
                <td>{root.lifecycle_state}</td>
                <td>{root.current_generation}</td>
                <td className="mono muted">{root.created_at}</td>
                <td>
                  <Link
                    href={buildHref(`/roots/${encodeURIComponent(root.root_id)}`, {
                      include_deprecated_root: includeDeprecated ? true : undefined,
                      include_deleted_root: includeDeleted ? true : undefined,
                    })}
                  >
                    open →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}