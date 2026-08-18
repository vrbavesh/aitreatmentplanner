"use client";
// LLD v2 §9/§12 — document upload. Validates client-side before any network call,
// uploads to Storage, inserts the `documents` row, then triggers POST /extract.
import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { validateUpload } from "@/lib/uploadValidation";
import { extractDocument } from "@/lib/api";

const DOC_TYPES = ["blood_report", "surgery_report", "medical_history"] as const;
type DocType = (typeof DOC_TYPES)[number];

interface UploadFormProps {
  patientId: string;
}

export default function UploadForm({ patientId }: UploadFormProps) {
  const [docType, setDocType] = useState<DocType>("blood_report");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!file) {
      setError("Please choose a file to upload.");
      return;
    }

    // Client-side validation — reject before any network call (LLD §12).
    const validation = validateUpload(file);
    if (!validation.valid) {
      setError(validation.error ?? "Invalid file");
      return;
    }

    setUploading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const storagePath = `${user.id}/${crypto.randomUUID()}`;
      const { error: uploadError } = await supabase.storage
        .from("reports")
        .upload(storagePath, file);
      if (uploadError) throw uploadError;

      const { data: doc, error: insertError } = await supabase
        .from("documents")
        .insert({
          patient_id: patientId,
          doc_type: docType,
          storage_path: storagePath,
          file_mime_type: file.type,
          file_size_bytes: file.size,
          extraction_status: "pending",
        })
        .select()
        .single();
      if (insertError) throw insertError;

      // Kick off extraction on the backend with the user's JWT attached.
      const extractResult = await extractDocument(doc.id);
      setResult(
        `Uploaded ${file.name}. Extraction ${extractResult.status} (${extractResult.fields_extracted} fields).`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form">
      <h2>Upload Report</h2>
      <label>
        Document type
        <select value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
          {DOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
      <label>
        File (PDF, JPEG, or PNG; max 10MB)
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {error && <p className="error">{error}</p>}
      {result && <p className="success">{result}</p>}
      <button type="submit" disabled={uploading}>
        {uploading ? "Uploading…" : "Upload & extract"}
      </button>
    </form>
  );
}