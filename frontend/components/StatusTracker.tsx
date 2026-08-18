"use client";
// HLD §3.1 — Status Tracker. Polls documents.extraction_status + approvals.status every
// 3 seconds while pending/processing (HLD §0.4). Realtime is NOT used.
import { useStatusPolling } from "@/lib/statusPolling";

interface StatusTrackerProps {
  patientId: string;
}

export default function StatusTracker({ patientId }: StatusTrackerProps) {
  const { documents, approval } = useStatusPolling(patientId);

  return (
    <section>
      <h2>Status</h2>
      <h3>Documents</h3>
      {documents.length === 0 ? (
        <p>No documents uploaded yet.</p>
      ) : (
        <ul>
          {documents.map((d) => (
            <li key={d.id}>
              {d.doc_type.replace(/_/g, " ")} —{" "}
              <strong>{d.extraction_status}</strong>
              {d.extraction_status === "failed" && " (doctor can enter fields manually)"}
            </li>
          ))}
        </ul>
      )}
      <h3>Approval</h3>
      <p>
        {approval ? (
          <>
            Status: <strong>{approval.status}</strong>
            {approval.status === "approved" && " — your final plan is ready."}
            {(approval.status === "pending" || approval.status === "rejected") && (
              " — pending doctor review."
            )}
          </>
        ) : (
          "No approval record yet — pending review."
        )}
      </p>
    </section>
  );
}