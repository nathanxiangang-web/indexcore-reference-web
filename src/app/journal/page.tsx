import Link from "next/link";

import { RootPicker } from "@/components/controls";
import { EmptyState, ErrorNotice } from "@/components/notices";
import { getIndexCoreClient } from "@/lib/indexcore/server";
import { load } from "@/lib/load";
import { boolParam, buildHref, firstParam, intParam, type SearchParams } from "@/lib/query";

export const dynamic = "force-dynamic";

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const root = firstParam(sp.root);
  const afterSeq = intParam(sp.after_seq, 0);
  const limit = intParam(sp.limit, 50);
  const includeDeprecatedRoot = boolParam(sp.include_deprecated_root);
  const includeDeletedRoot = boolParam(sp.include_deleted_root);

  const client = getIndexCoreClient();
  const rootsResult = await load(() =>
    client.listRoots({ include_deprecated: true, include_deleted: true }),
  );

  const journalResult = root
    ? await load(() => client.readJournal(root, { after_seq: afterSeq, limit }))
    : undefined;

  const lastSeq =
    journalResult && journalResult.ok && journalResult.value.length > 0
      ? journalResult.value[journalResult.value.length - 1].event_seq
      : undefined;

  // IndexCore's read_journal selects `event_seq > after_seq`, so the next page
  // starts at the LAST event_seq of this page — never lastSeq + 1 (which would
  // silently skip the very next event).
  const hasMore = journalResult?.ok === true && journalResult.value.length >= limit;

  // Root visibility must survive into Q3 resource detail: a journal entry of a
  // resource inside a DEPRECATED/DELETED root still needs the matching opt-in.
  const rootVisibility = {
    include_deprecated_root: includeDeprecatedRoot ? true : undefined,
    include_deleted_root: includeDeletedRoot ? true : undefined,
  };
  const linkParams = {
    root,
    limit,
    include_deprecated_root: includeDeprecatedRoot ? true : undefined,
    include_deleted_root: includeDeletedRoot ? true : undefined,
  };
  const resetHref = buildHref("/journal", linkParams);

  return (
    <>
      <h1>Journal</h1>
      <p className="note">
        Q8 <code>read_journal</code>. Ordering is per-root only (<code>event_seq</code>); there
        is no global cross-root event order. Root visibility below is carried into resource
        detail.
      </p>

      {rootsResult.ok ? (
        <RootPicker action="/journal" roots={rootsResult.value} selected={root}>
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
        <EmptyState>Select a root to read its journal.</EmptyState>
      ) : journalResult && !journalResult.ok ? (
        <ErrorNotice failure={journalResult} resetHref={resetHref} />
      ) : journalResult && journalResult.ok ? (
        journalResult.value.length === 0 ? (
          <EmptyState>No journal events after seq {afterSeq}.</EmptyState>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>event_seq</th>
                  <th>generation</th>
                  <th>intra</th>
                  <th>event_type</th>
                  <th>resource_id</th>
                  <th>committed_at</th>
                  <th>payload</th>
                </tr>
              </thead>
              <tbody>
                {journalResult.value.map((event) => (
                  <tr key={event.event_seq}>
                    <td className="mono">{event.event_seq}</td>
                    <td className="mono">{event.generation_number}</td>
                    <td className="mono">{event.intra_generation_seq}</td>
                    <td>{event.event_type}</td>
                    <td className="mono">
                      {event.resource_id ? (
                        <Link
                          href={buildHref(
                            `/resources/${encodeURIComponent(event.resource_id)}`,
                            { include_removed: true, ...rootVisibility },
                          )}
                        >
                          {event.resource_id}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="mono muted">{event.committed_at}</td>
                    <td>
                      {event.payload ? (
                        <pre className="payload">{event.payload}</pre>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="pagination">
              <Link href={buildHref("/journal", linkParams)}>← Reload</Link>
              {hasMore && lastSeq !== undefined ? (
                <Link href={buildHref("/journal", { ...linkParams, after_seq: lastSeq })}>
                  Next events →
                </Link>
              ) : (
                <span className="muted">End</span>
              )}
            </div>
          </>
        )
      ) : null}
    </>
  );
}
