// LLD v2 §12 — client-side file type/size validation.
const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const MAX_SIZE_BYTES = 10485760; // 10MB, must match backend MAX_UPLOAD_BYTES exactly

export function validateUpload(file: File): { valid: boolean; error?: string } {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { valid: false, error: "Only PDF, JPEG, and PNG files are supported." };
  }
  if (file.size > MAX_SIZE_BYTES) {
    return { valid: false, error: "File must be under 10MB." };
  }
  return { valid: true };
}