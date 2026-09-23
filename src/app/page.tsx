import Link from "next/link";

import { isIndexCoreError } from "@/lib/indexcore/errors";
import { getIndexCoreClient } from "@/lib/indexcore/server";
import type { Root, ReadyStatus, HealthStatus } from "@/lib/indexcore/types";

// Never prerender: the status page must reflect a live IndexCore, and a build
// must not fail (or bake in stale data) when IndexCore is unreachable.
export const dynamic = "force-dynamic";

interface Failure {
  label: string;
  kind: string;
  message: string;
}

interface Summary {

  health?: HealthStatus;
  ready?: ReadyStatus;
  roots?: Root[];
  failures: Failure[];
}

async function capture(summary: Summary, label: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    summary.failures.push({
      label,
      kind: isIndexCoreError(error) ? error.kind : "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loadSummary(): Promise<Summary> {
  const client = getIndexCoreClient();
  const summary: Summary = { failures: [] };

  await capture(summary, "GET /healthz", async () => {
    summary.health = await client.health();
  });
  await capture(summary, "GET /readyz", async () => {
    summary.ready = await client.ready();
  });
  await capture(summary, "Q2 list_roots", async () => {
    summary.roots = await client.listRoots();
  });

  return summary;
}

function Value({ value }: { value: string }) {
  return <div className="value">{value}</div>;
}

export default async function HomePage() {
  const summary = await loadSummary();
  const degraded = summary.failures.length > 0;

  return (
    <>
      <h1>Runtime status</h1>
      <p className="note">
        Read-only consumer of the IndexCore <code>/v1</code> Query Contract. All requests are
        issued server-side from this Next.js process; the browser never talks to IndexCore and
        is never told IndexCore&apos;s internal address.
      </p>

      {degraded ? (
        <div className="alert" role="alert">
          <strong>IndexCore is not fully available.</strong> No data is faked; failing calls are
          shown below.
          <ul>
            {summary.failures.map((failure) => (
              <li key={failure.label}>
                <code>{failure.label}</code> — <span className="mono">{failure.kind}</span>:{" "}
                {failure.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="cards">
        <div className="card">
          <div className="label">Liveness</div>
          {summary.health ? (
            <Value value={summary.health.status} />
          ) : (
            <Value value="unavailable" />
          )}
          {summary.health?.version ? (
            <div className="muted mono">version {summary.health.version}</div>
          ) : null}
        </div>
        <div className="card">
          <div className="label">Readiness</div>
          {summary.ready ? (
            <Value value={summary.ready.status} />
          ) : (
            <Value value="unavailable" />
          )}
          {summary.ready?.schema_applied !== undefined ? (
            <div className="muted mono">schema v{summary.ready.schema_applied}</div>
          ) : null}
        </div>
        <div className="card">
          <div className="label">Roots</div>
          <Value value={summary.roots ? String(summary.roots.length) : "unavailable"} />
          <div className="muted">Q2 list_roots</div>
        </div>
      </div>

      <h2>Roots</h2>
      {summary.roots === undefined ? (
        <p className="muted">Root list unavailable.</p>
      ) : summary.roots.length === 0 ? (
        <p className="muted">No visible roots.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>root_id</th>
              <th>lifecycle</th>
              <th>generation</th>
              <th>created_at</th>
            </tr>
          </thead>
          <tbody>
            {summary.roots.map((root) => (
              <tr key={root.root_id}>
                <td className="mono">
                  <Link href={`/roots/${encodeURIComponent(root.root_id)}`}>
                    {root.root_id}
                  </Link>
                </td>
                <td>{root.lifecycle_state}</td>
                <td>{root.current_generation}</td>
                <td className="mono muted">{root.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}