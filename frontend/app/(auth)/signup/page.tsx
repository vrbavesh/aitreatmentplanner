"use client";
// HLD §3.1 — signup. Self-service signups are patients; the patient `role` claim is
// applied by the trg_set_patient_role_on_signup trigger (0004). Doctors are not
// self-service signups (LLD §2.2) — they are provisioned via an admin script.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { role: "patient" } },
      });
      if (error) throw error;
      setMessage(
        "Account created. If email confirmation is enabled, check your inbox before logging in.",
      );
      setTimeout(() => router.push("/login"), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form">
      <h1>Sign up (Patient)</h1>
      <p>
        Doctors are not self-service signups — they are provisioned by an administrator
        (LLD §2.2).
      </p>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error && <p className="error">{error}</p>}
      {message && <p className="success">{message}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Creating…" : "Sign up"}
      </button>
      <p>
        Already have an account? <a href="/login">Login</a>
      </p>
    </form>
  );
}