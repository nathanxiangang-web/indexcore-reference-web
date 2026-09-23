import Link from "next/link";

import { ErrorNotice } from "@/components/notices";
import { getIndexCoreClient } from "@/lib/indexcore/server";
import { load } from "@/lib/load";
import { boolParam, buildHref, type SearchParams } from "@/lib/query";

export const dynamic = "force-dynamic";

function orDash(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return String(value);
}

export default async function ResourceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ resourceId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { resourceId } = await params;
  const sp = await searchParams;
  const includeRemoved = boolParam(sp.include_removed);
  const includeDeprecatedRoot = boolParam(sp.include_deprecated_root);
  const includeDeletedRoot = boolParam(sp.include_deleted_root);

  const client = getIndexCoreClient();
  const result = await load(() =>
    client.getResource(resourceId, {
      include_removed: includeRemoved,
      include_deprecated_root: includeDeprecatedRoot,
      include_deleted_root: includeDeletedRoot,
    }),
  );

  const basePath = `/resources/${encodeURIComponent(resourceId)}`;
  const link = (overrides: Record<string, boolean | undefined>) =>
    buildHref(basePath, {
      include_removed: includeRemoved ? true : undefined,
      include_deprecated_root: includeDeprecatedRoot ? true : undefined,
      include_deleted_root: includeDeletedRoot ? true : undefined,
      ...overrides,
    });

  return (
    <>
      <h1>Resource</h1>
      <p className="mono">{resourceId}</p>

      {!result.ok ? (
        <ErrorNotice failure={result} />
      ) : (
        <>
          <p className="picker">
            <Link href={link({ include_removed: includeRemoved ? undefined : true })}>
              {includeRemoved ? "Hide" : "Show"} removed
            </Link>
            <Link
              href={link({
                include_deprecated_root: includeDeprecatedRoot ? undefined : true,
              })}
            >
              {includeDeprecatedRoot ? "Hide" : "Show"} deprecated root
            </Link>
            <Link
              href={link({ include_deleted_root: includeDeletedRoot ? undefined : true })}
            >
              {includeDeletedRoot ? "Hide" : "Show"} deleted root
            </Link>
          </p>

          <dl className="kv">
            <dt>name</dt>
            <dd>{orDash(result.value.name)}</dd>
            <dt>is_dir</dt>
            <dd>{orDash(result.value.is_dir)}</dd>
            <dt>presence</dt>
            <dd>{result.value.resource_presence}</dd>
            <dt>canonical path</dt>
            <dd className="mono">{orDash(result.value.canonical_path)}</dd>
            <dt>size</dt>
            <dd className="mono">{orDash(result.value.size)}</dd>
            <dt>content type</dt>
            <dd>{orDash(result.value.content_type)}</dd>
            <dt>content hash</dt>
            <dd className="mono">{orDash(result.value.content_hash)}</dd>
            <dt>mtime</dt>
            <dd className="mono">{orDash(result.value.mtime)}</dd>
            <dt>introduced at generation</dt>
            <dd className="mono">{result.value.introduced_at_generation}</dd>
            <dt>last confirmed generation</dt>
            <dd className="mono">{result.value.last_confirmed_generation}</dd>
            <dt>root</dt>
            <dd className="mono">
              <Link href={`/roots/${encodeURIComponent(result.value.root_id)}`}>
                {result.value.root_id}
              </Link>
            </dd>
            <dt>parent resource</dt>
            <dd className="mono">
              {result.value.parent_resource_id ? (
                <Link
                  href={`/resources/${encodeURIComponent(result.value.parent_resource_id)}`}
                >
                  {result.value.parent_resource_id}
                </Link>
              ) : (
                "— (root level)"
              )}
            </dd>
          </dl>
        </>
      )}
    </>
  );
}