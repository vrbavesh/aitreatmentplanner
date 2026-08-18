"use client";
// HLD §3.1 / §4.3 — Doctor Comparison View: predictions + similarity side by side,
// inline extracted_fields correction, and approve/reject.
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { similarPatients } from "@/lib/api";
import TreatmentComparisonTable, {
  type TreatmentPrediction,
} from "@/components/TreatmentComparisonTable";
import SimilarPatientsPanel, {
  type SimilarityMatch,
} from "@/components/SimilarPatientsPanel";
import ApprovalActions from "@/components/ApprovalActions";

interface ExtractedField {
  id: string;
  document_id: string;
  field_name: string;
  field_value: string | null;
  confidence: number | null;
  manually_corrected: boolean;
}

export default function DoctorReviewPage() {
  const { patientId } = useParams<{ patientId: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<TreatmentPrediction[]>([]);
  const [matches, setMatches] = useState<SimilarityMatch[]>([]);
  const [fields, setFields] = useState<ExtractedField[]>([]);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadData = useCallback(async () => {
    const { data: fieldsData } = await supabase
      .from("documents")
      .select("id, extracted_fields(id, document_id, field_name, field_value, confidence, manually_corrected)")
      .eq("patient_id", patientId);
    const flat: ExtractedField[] = [];
    for (const doc of fieldsData ?? []) {
      for (const f of doc.extracted_fields ?? []) flat.push(f);
    }
    setFields(flat);

    const { data: preds } = await supabase
      .from("treatment_predictions")
      .select("*")
      .eq("patient_id", patientId);
    setPredictions((preds ?? []) as TreatmentPrediction[]);

    const { data: approval } = await supabase
      .from("approvals")
      .select("status")
      .eq("patient_id", patientId)
      .maybeSingle();
    setApprovalStatus(approval?.status ?? null);

    const result = await similarPatients(patientId);
    setMatches(result.matches ?? []);
  }, [patientId]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace("/login");
        return;
      }
      if (user.app_metadata?.role !== "doctor") {
        router.replace("/patient/dashboard");
        return;
      }
      setDoctorId(user.id);
      setLoading(false);
      try {
        await loadData();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load review data");
      }
    });
  }, [router, loadData]);

  function updateField(id: string, value: string) {
    setFields((fs) => fs.map((f) => (f.id === id ? { ...f, field_value: value } : f)));
  }

  async function saveCorrections() {
    setError(null);
    setSaved(false);
    const changed = fields.filter((f) => f.manually_corrected || true);
    try {
      for (const f of changed) {
        const { error } = await supabase
          .from("extracted_fields")
          .update({ field_value: f.field_value, manually_corrected: true })
          .eq("id", f.id);
        if (error) throw error;
      }
      setSaved(true);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save corrections");
    }
  }

  if (loading) return <p>Loading…</p>;

  return (
    <>
      <h1>Review patient {patientId}</h1>
      {error && <p className="error">{error}</p>}
      <p>
        Approval status: <strong>{approvalStatus ?? "none"}</strong>
      </p>
      <TreatmentComparisonTable predictions={predictions} />
      <section>
        <h2>Extracted Fields</h2>
        {fields.length === 0 ? (
          <p>No extracted fields. Run extraction or enter them manually.</p>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>Value (editable)</th>
                  <th>Confidence</th>
                  <th>Verified</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.id}>
                    <td>{f.field_name}</td>
                    <td>
                      <input
                        type="text"
                        value={f.field_value ?? ""}
                        onChange={(e) => updateField(f.id, e.target.value)}
                      />
                    </td>
                    <td>{f.confidence != null ? f.confidence.toFixed(2) : "—"}</td>
                    <td>{f.manually_corrected ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={saveCorrections}>Save corrections</button>
            {saved && <p className="success">Corrections saved.</p>}
            <p className="hint">
              Saving a correction flips approvals.status back to pending if it was approved
              (DB trigger).
            </p>
          </>
        )}
      </section>
      <SimilarPatientsPanel matches={matches} />
      {doctorId && (
        <ApprovalActions patientId={patientId} doctorId={doctorId} onDecided={loadData} />
      )}
      <p>
        <a href="/doctor/queue">Back to queue →</a>
      </p>
    </>
  );
}