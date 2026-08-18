"use client";
// HLD §3.1 — Patient Profile Form. Direct Supabase insert/update (RLS-scoped).
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export interface PatientProfile {
  id?: string;
  age: number | null;
  gender: string;
  is_pregnant: boolean;
  is_diabetic: boolean;
  current_condition: string;
  pulse: number | null;
  allergies: string[];
  lifestyle_healthy: boolean | null;
}

interface ProfileFormProps {
  existing?: PatientProfile | null;
  onSaved?: (profile: PatientProfile) => void;
}

const EMPTY: PatientProfile = {
  age: null,
  gender: "",
  is_pregnant: false,
  is_diabetic: false,
  current_condition: "",
  pulse: null,
  allergies: [],
  lifestyle_healthy: null,
};

export default function ProfileForm({ existing = null, onSaved }: ProfileFormProps) {
  const [form, setForm] = useState<PatientProfile>(existing ?? EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof PatientProfile>(key: K, value: PatientProfile[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const row = {
        age: form.age,
        gender: form.gender || null,
        is_pregnant: form.is_pregnant,
        is_diabetic: form.is_diabetic,
        current_condition: form.current_condition || null,
        pulse: form.pulse,
        allergies: form.allergies,
        lifestyle_healthy: form.lifestyle_healthy,
      };

      if (existing?.id) {
        const { error } = await supabase.from("patients").update(row).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("patients").insert({ ...row, user_id: user.id });
        if (error) throw error;
      }
      setSaved(true);
      onSaved?.(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form">
      <h2>Patient Profile</h2>
      <label>
        Age
        <input
          type="number"
          min={1}
          max={129}
          value={form.age ?? ""}
          onChange={(e) => set("age", e.target.value === "" ? null : Number(e.target.value))}
        />
      </label>
      <label>
        Gender
        <select value={form.gender} onChange={(e) => set("gender", e.target.value)}>
          <option value="">—</option>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={form.is_pregnant}
          onChange={(e) => set("is_pregnant", e.target.checked)}
        />
        Pregnant
      </label>
      <label>
        <input
          type="checkbox"
          checked={form.is_diabetic}
          onChange={(e) => set("is_diabetic", e.target.checked)}
        />
        Diabetic
      </label>
      <label>
        Current condition (disease/defect)
        <input
          type="text"
          value={form.current_condition}
          onChange={(e) => set("current_condition", e.target.value)}
          placeholder="e.g. type 2 diabetes, hypertension"
        />
      </label>
      <label>
        Pulse (bpm)
        <input
          type="number"
          min={1}
          max={299}
          value={form.pulse ?? ""}
          onChange={(e) => set("pulse", e.target.value === "" ? null : Number(e.target.value))}
        />
      </label>
      <label>
        Allergies (comma separated)
        <input
          type="text"
          value={form.allergies.join(", ")}
          onChange={(e) =>
            set(
              "allergies",
              e.target.value.split(",").map((a) => a.trim()).filter(Boolean),
            )
          }
        />
      </label>
      <label>
        Lifestyle
        <select
          value={form.lifestyle_healthy === null ? "" : form.lifestyle_healthy ? "healthy" : "unhealthy"}
          onChange={(e) =>
            set("lifestyle_healthy", e.target.value === "" ? null : e.target.value === "healthy")
          }
        >
          <option value="">—</option>
          <option value="healthy">Healthy</option>
          <option value="unhealthy">Unhealthy</option>
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      {saved && <p className="success">Profile saved.</p>}
      <button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}