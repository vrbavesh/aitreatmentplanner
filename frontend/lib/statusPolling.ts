// LLD v2 §9 — 3-second polling hook (replaces Realtime, per HLD §0.4).
"use client";
import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

export interface DocumentRow {
  id: string;
  patient_id: string;
  doc_type: string;
  storage_path: string;
  file_mime_type: string;
  file_size_bytes: number;
  extraction_status: "pending" | "processing" | "done" | "failed";
  created_at?: string;
}

export interface ApprovalRow {
  id: string;
  patient_id: string;
  doctor_id: string | null;
  status: "pending" | "approved" | "rejected";
  doctor_notes?: string | null;
  decided_at?: string | null;
}

export function useStatusPolling(patientId: string, intervalMs = 3000) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [approval, setApproval] = useState<ApprovalRow | null>(null);

  useEffect(() => {
    let active = true;
    async function poll() {
      const { data: docs } = await supabase
        .from("documents")
        .select("*")
        .eq("patient_id", patientId);
      const { data: appr } = await supabase
        .from("approvals")
        .select("*")
        .eq("patient_id", patientId)
        .maybeSingle();
      if (!active) return;
      setDocuments((docs ?? []) as DocumentRow[]);
      setApproval((appr ?? null) as ApprovalRow | null);
      const stillPending =
        (docs ?? []).some((d) => ["pending", "processing"].includes(d.extraction_status)) ||
        appr?.status === "pending";
      if (stillPending) setTimeout(poll, intervalMs);
    }
    poll();
    return () => {
      active = false;
    };
  }, [patientId, intervalMs]);

  return { documents, approval };
}