"use client";
// HLD §3.1 / §4.3 — Doctor Queue: patients with approvals.status = 'pending'.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

interface PendingApproval {
  id: string;
  patient_id: string;
  status: string;
  decided_at?: string | null;
  patients: {
    id: string;
    age: number | null;
    gender: string | null;
    current_condition: string | null;
  }[] | null;
}

export default function DoctorQueuePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadQueue() {
    setError(null);
    const { data, error } = await supabase
      .from("approvals")
      .select("id, patient_id, status, decided_at, patients(id, age, gender, current_condition)")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) setError(error.message);
    else setPending((data ?? []) as PendingApproval[]);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const user = data.session?.user;
      if (!user) {
        router.replace("/login");
        return;
      }
      if (user.app_metadata?.role !== "doctor") {
        router.replace("/patient/dashboard");
        return;
      }
      setLoading(false);
      loadQueue();
    });
  }, [router]);

  if (loading) return <p>Loading…</p>;

  return (
    <>
      <h1>Doctor Queue</h1>
      <button onClick={loadQueue}>Refresh</button>
      {error && <p className="error">{error}</p>}
      {pending.length === 0 ? (
        <p>No patients awaiting review.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Age</th>
              <th>Gender</th>
              <th>Current condition</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {pending.map((a) => (
              <tr key={a.id}>
                <td>{a.patient_id}</td>
                <td>{a.patients?.[0]?.age ?? "—"}</td>
                <td>{a.patients?.[0]?.gender ?? "—"}</td>
                <td>{a.patients?.[0]?.current_condition ?? "—"}</td>
                <td>
                  <a href={`/doctor/review/${a.patient_id}`}>Review →</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}