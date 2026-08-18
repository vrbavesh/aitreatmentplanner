"use client";
// HLD §3.1 / LLD §9 — Approve/Reject. Updates the approvals row directly via Supabase.
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

interface ApprovalActionsProps {
  patientId: string;
  doctorId: string;
  onDecided?: () => void;
}

export default function ApprovalActions({
  patientId,
  doctorId,
  onDecided,
}: ApprovalActionsProps) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(status: "approved" | "rejected") {
    setError(null);
    setBusy(true);
    try {
      const row = {
        patient_id: patientId,
        doctor_id: doctorId,
        status,
        doctor_notes: notes.trim() || null,
        decided_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("approvals")
        .upsert(row, { onConflict: "patient_id" });
      if (error) throw error;
      onDecided?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update approval");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Decision</h2>
      <label>
        Doctor notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </label>
      {error && <p className="error">{error}</p>}
      <button type="button" onClick={() => decide("approved")} disabled={busy}>
        Approve
      </button>{" "}
      <button type="button" onClick={() => decide("rejected")} disabled={busy}>
        Reject
      </button>
    </section>
  );
}