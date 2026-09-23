import Link from "next/link";
import type { ReactNode } from "react";

import type { LoadFailure } from "@/lib/load";

/** Renders a typed IndexCore failure without fabricating data. */
export function ErrorNotice({
  failure,
  resetHref,
}: {
  failure: LoadFailure;
  resetHref?: string;
}) {
  if (failure.kind === "stale_cursor") {
    return (
      <div className="alert warn" role="alert">
        <strong>Data changed while paging.</strong> This cursor is bound to a generation that is
        no longer current, so the page cannot be continued.
        {resetHref ? (
          <>
            {" "}
            <Link href={resetHref}>Reload from the first page</Link>.
          </>
        ) : null}
      </div>
    );
  }

  if (failure.kind === "invalid_cursor") {
    return (
      <div className="alert warn" role="alert">
        <strong>Invalid cursor.</strong> The page cursor could not be read.
        {resetHref ? (
          <>
            {" "}
            <Link href={resetHref}>Reload from the first page</Link>.
          </>
        ) : null}
      </div>
    );
  }

  if (failure.kind === "unavailable" || failure.kind === "timeout") {
    return (
      <div className="alert" role="alert">
        <strong>IndexCore is unreachable.</strong> {failure.message}
      </div>
    );
  }

  if (failure.kind === "not_found") {
    return (
      <div className="alert" role="alert">
        <strong>Not found.</strong> {failure.message}
      </div>
    );
  }

  return (
    <div className="alert" role="alert">
      <strong>IndexCore request failed</strong> — <span className="mono">{failure.kind}</span>
      {failure.status ? <span className="mono"> (HTTP {failure.status})</span> : null}:{" "}
      {failure.message}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="muted">{children}</p>;
}