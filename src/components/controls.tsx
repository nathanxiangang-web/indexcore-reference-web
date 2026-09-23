import Link from "next/link";

import type { Resource, Root } from "@/lib/indexcore/types";
import { buildHref } from "@/lib/query";

const NAV_LINKS = [
  { href: "/", label: "Status" },
  { href: "/roots", label: "Roots" },
  { href: "/resolve", label: "Resolve" },
  { href: "/removed", label: "Removed" },
  { href: "/journal", label: "Journal" },
];

export function SiteNav() {
  return (
    <nav className="nav">
      {NAV_LINKS.map((link) => (
        <Link key={link.href} href={link.href}>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

/** A GET form that selects one root for a root-scoped page. */
export function RootPicker({
  action,
  roots,
  selected,
}: {
  action: string;
  roots: Root[];
  selected?: string;
}) {
  return (
    <form className="picker" method="get" action={action}>
      <label>
        Root{" "}
        <select name="root" defaultValue={selected ?? ""}>
          <option value="">— select a root —</option>
          {roots.map((root) => (
            <option key={root.root_id} value={root.root_id}>
              {root.root_id} ({root.lifecycle_state}, gen {root.current_generation})
            </option>
          ))}
        </select>
      </label>
      <button type="submit">Go</button>
    </form>
  );
}

/** Generation-bound pagination. The cursor is always round-tripped verbatim. */
export function Pagination({
  basePath,
  params,
  nextCursor,
  hasCursor,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  nextCursor: string | null;
  hasCursor: boolean;
}) {
  return (
    <div className="pagination">
      {hasCursor ? (
        <Link href={buildHref(basePath, { ...params, cursor: undefined })}>← First page</Link>
      ) : (
        <span className="muted">First page</span>
      )}
      {nextCursor ? (
        <Link href={buildHref(basePath, { ...params, cursor: nextCursor })}>Next page →</Link>
      ) : (
        <span className="muted">No more pages</span>
      )}
    </div>
  );
}

export function Breadcrumbs({ rootId, trail }: { rootId: string; trail: Resource[] }) {
  return (
    <nav className="breadcrumbs">
      <Link href={`/roots/${encodeURIComponent(rootId)}`}>root</Link>
      {trail.map((resource) => (
        <span key={resource.resource_id}>
          {" / "}
          <Link
            href={`/roots/${encodeURIComponent(rootId)}?parent=${encodeURIComponent(resource.resource_id)}`}
          >
            {resource.name ?? resource.resource_id}
          </Link>
        </span>
      ))}
    </nav>
  );
}