import Link from "next/link";

import type { Resource } from "@/lib/indexcore/types";

function formatSize(size?: number | null): string {
  if (size === undefined || size === null) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}

/** A hierarchy-aware resource table: directories link to their children. */
export function ResourceTable({
  rootId,
  resources,
}: {
  rootId: string;
  resources: Resource[];
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
                  href={`/roots/${encodeURIComponent(rootId)}?parent=${encodeURIComponent(resource.resource_id)}`}
                >
                  {resource.name ?? "(unnamed)"}/
                </Link>
              ) : (
                <Link href={`/resources/${encodeURIComponent(resource.resource_id)}`}>
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