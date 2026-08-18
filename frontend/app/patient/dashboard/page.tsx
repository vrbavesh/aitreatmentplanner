"use client";
// HLD §3.1 / §4.4 — Patient Dashboard: status tracker + final plan.
// Rule: only approvals.status='approved' rows render as a final plan (Flow D).
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { predictPatient, similarPatients } from "@/lib/api";
import StatusTracker from "@/components/StatusTracker";
import TreatmentComparisonTable, {
  type TreatmentPrediction,
} from "@/components/TreatmentComparisonTable";
import SimilarPatientsPanel, {
  type SimilarityMatch,
} from "@/components/SimilarPatientsPanel";

export default function PatientDashboardPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [patientId, setPatientId] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<string | null>(null);
  const [predictions, setPredictions] = useState<TreatmentPrediction[]>([]);
  const [matches, setMatches] = useState<SimilarityMatch[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async (pid: string) => {
    const { data: approval } = await supabase
      .from("approvals")
      .select("status")
      .eq("patient_id", pid)
      .maybeSingle();
    setApprovalStatus(approval?.status ?? null);

    const { data: preds } = await supabase
      .from("treatment_predictions")
      .select("*")
      .eq("patient_id", pid);
    setPredictions((preds ?? []) as TreatmentPrediction[]);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace("/login");
        return;
      }
      if (user.app_metadata?.role === "doctor") {
        router.replace("/doctor/queue");
        return;
      }
      const { data: row } = await supabase
        .from("patients")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (row?.id) {
        setPatientId(row.id);
        await loadData(row.id);
      }
      setLoading(false);
    });
  }, [router, loadData]);

  async function runPredict() {
    if (!patientId) return;
    setBusy("predict");
    setError(null);
    try {
      const result = await predictPatient(patientId);
      await loadData(patientId);
      if (result.approval_reset) {
        alert("Prediction regenerated — the previous approval was reset to pending.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prediction failed");
    } finally {
      setBusy(null);
    }
  }

  async function runSimilar() {
    if (!patientId) return;
    setBusy("similar");
    setError(null);
    try {
      const result = await similarPatients(patientId);
      setMatches(result.matches ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Similarity search failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <p>Loading…</p>;
  if (!patientId) {
    return (
      <p>
        You need a patient profile first. <a href="/patient/profile">Create your profile →</a>
      </p>
    );
  }

  const showPlan = approvalStatus === "approved";

  return (
    <>
      <h1>Patient Dashboard</h1>
      <StatusTracker patientId={patientId} />
      <section>
        <h2>AI Actions</h2>
        <button onClick={runPredict} disabled={busy !== null}>
          {busy === "predict" ? "Predicting…" : "Trigger AI prediction"}
        </button>{" "}
        <button onClick={runSimilar} disabled={busy !== null}>
          {busy === "similar" ? "Searching…" : "Find similar patients"}
        </button>
        {error && <p className="error">{error}</p>}
      </section>
      {showPlan ? (
        <>
          <p className="success">Your doctor approved this plan.</p>
          <TreatmentComparisonTable predictions={predictions} />
        </>
      ) : (
        <p>Your plan is pending doctor review. AI-suggested treatments are not shown until approved.</p>
      )}
      <SimilarPatientsPanel matches={matches} />
      <p>
        <a href="/patient/upload">Upload another report →</a>{" "}
        <a href="/patient/profile">Edit profile →</a>
      </p>
    </>
  );
}