// LLD v2 §9 — thin wrapper for the 3 FastAPI calls; attaches the user JWT.
"use client";
import { supabase } from "./supabaseClient";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

async function callBackend(path: string, method = "POST") {
  if (!BACKEND_URL) {
    throw new Error(
      "NEXT_PUBLIC_BACKEND_URL is not set in frontend/.env.local (e.g. http://127.0.0.1:8000)",
    );
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${session?.access_token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function extractDocument(documentId: string) {
  return callBackend(`/extract/${documentId}`);
}

export function predictPatient(patientId: string) {
  return callBackend(`/predict/${patientId}`);
}

export function similarPatients(patientId: string) {
  return callBackend(`/similar/${patientId}`);
}