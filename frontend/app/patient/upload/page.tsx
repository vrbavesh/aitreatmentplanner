"use client";
// HLD §3.1 — document upload page.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import UploadForm from "@/components/UploadForm";
import StatusTracker from "@/components/StatusTracker";

export default function PatientUploadPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [patientId, setPatientId] = useState<string | null>(null);

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
      setPatientId(row?.id ?? null);
      setLoading(false);
    });
  }, [router]);

  if (loading) return <p>Loading…</p>;

  if (!patientId) {
    return (
      <p>
        You need a patient profile before uploading.{" "}
        <a href="/patient/profile">Create your profile →</a>
      </p>
    );
  }

  return (
    <>
      <UploadForm patientId={patientId} />
      <StatusTracker patientId={patientId} />
      <p>
        <a href="/patient/dashboard">Dashboard →</a>
      </p>
    </>
  );
}