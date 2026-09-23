import Link from "next/link";

import type { Resource } from "@/lib/indexcore/types";
import { buildHref, type LinkQuery } from "@/lib/query";

function formatSize(size?: number | null): string {
  if (size === undefined || size === null) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * A hierarchy-aware resource table: directories link to their children.
 *
 * `linkQuery` carries the current visibility opt-ins (include_removed /
 * include_deprecated_root / include_deleted_root) so navigating into a
 * directory or a resource detail never silently drops the partition the user
 * was looking at.
 */
export function ResourceTable({
  rootId,
  resources,
  linkQuery,
}: {
  rootId: string;
  resources: Resource[];
  linkQuery?: LinkQuery;
}) {
  return (
    <table>
      <thead>
        <tr>
          <th>name</th>
          <th>type</th>
          <th>size</th>
          <th>presence</th>
          <th>introduced→confirmed</th>
          <th>canonical path</th>
        </tr>
      </thead>
      <tbody>
        {resources.map((resource) => (
          <tr key={resource.resource_id}>
            <td>
              {resource.is_dir ? (
                <Link
                  href={buildHref(`/roots/${encodeURIComponent(rootId)}`, {
                    ...linkQuery,
                    parent: resource.resource_id,
                  })}
                >
                  {resource.name ?? "(unnamed)"}/
                </Link>
              ) : (
                <Link
                  href={buildHref(
                    `/resources/${encodeURIComponent(resource.resource_id)}`,
                    linkQuery,
                  )}
                >
                  {resource.name ?? "(unnamed)"}
                </Link>
              )}
            </td>
            <td>{resource.is_dir ? "dir" : "file"}</td>
            <td>{resource.is_dir ? "—" : formatSize(resource.size)}</td>
            <td>{resource.resource_presence}</td>
            <td className="mono">
              {resource.introduced_at_generation}→{resource.last_confirmed_generation}
            </td>
            <td className="mono muted">{resource.canonical_path ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
