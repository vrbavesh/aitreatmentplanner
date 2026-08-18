"use client";
// HLD §3.1 — Patient Profile page.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import ProfileForm, { type PatientProfile } from "@/components/ProfileForm";

export default function PatientProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState<PatientProfile | null>(null);

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
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      if (row) {
        setExisting({
          id: row.id,
          age: row.age,
          gender: row.gender ?? "",
          is_pregnant: row.is_pregnant,
          is_diabetic: row.is_diabetic,
          current_condition: row.current_condition ?? "",
          pulse: row.pulse,
          allergies: row.allergies ?? [],
          lifestyle_healthy: row.lifestyle_healthy ?? null,
        });
      }
      setLoading(false);
    });
  }, [router]);

  if (loading) return <p>Loading…</p>;

  return (
    <>
      <ProfileForm existing={existing} onSaved={() => setExisting(existing)} />
      <p>
        <a href="/patient/upload">Upload a report →</a>{" "}
        <a href="/patient/dashboard">Dashboard →</a>
      </p>
    </>
  );
}