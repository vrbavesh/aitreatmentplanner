# LLD v2 §6.2 — POST /predict/{patient_id}
from fastapi import APIRouter, Depends, HTTPException

from models.schemas import AuthenticatedCaller, Patient
from services.auth_service import authorize_patient_access, verify_caller
from services.gemini_service import GeminiProviderError
from services.heuristic_engine import evaluate
from services.supabase_client import get_maybe_single, supabase

router = APIRouter()


def fetch_all_extracted_fields_for_patient(patient_id: str) -> list[dict]:
    """All extracted_fields for a patient, joined through documents."""
    docs = (
        supabase.table("documents").select("id").eq("patient_id", patient_id).execute().data
    )
    doc_ids = [d["id"] for d in docs]
    if not doc_ids:
        return []
    return (
        supabase.table("extracted_fields")
        .select("*")
        .in_("document_id", doc_ids)
        .execute()
        .data
    )


@router.post("/predict/{patient_id}")
async def predict(patient_id: str, caller: AuthenticatedCaller = Depends(verify_caller)):
    patient = get_maybe_single("patients", "id", patient_id)
    if patient is None:
        raise HTTPException(404, detail={"error": "not_found", "detail": "Patient not found"})
    authorize_patient_access(caller, patient)  # §11 — 403 if not owner/doctor

    extracted = fetch_all_extracted_fields_for_patient(patient_id)  # join through documents
    try:
        predictions = evaluate(Patient.from_row(patient))  # §7 — includes improvement_band, confidence_score
    except GeminiProviderError:
        # LLD §3.4 — 502 is the documented code for an upstream Gemini failure.
        raise HTTPException(
            502,
            detail={"error": "upstream_provider_failure", "detail": "Gemini API call failed"},
        )

    # TODO(spec-gap): LLD §6.2 reads back `approvals.status` AFTER the insert and expects it
    # to equal 'approved' to report approval_reset — but the DB trigger (trg_reset_approval_
    # on_new_prediction) has already flipped it to 'pending' by then, so the read-back would
    # always be false. Capture the pre-insert status instead so the response satisfies the
    # acceptance criteria in §13 step 7 ("approval_reset: true" when a reset occurred).
    existing_approval = get_maybe_single("approvals", "patient_id", patient_id)
    approval_was_reset = bool(existing_approval and existing_approval["status"] == "approved")

    # Idempotent write: replace prior predictions rather than appending.
    supabase.table("treatment_predictions").delete().eq("patient_id", patient_id).execute()
    supabase.table("treatment_predictions").insert([
        {**p.model_dump(), "patient_id": patient_id} for p in predictions
    ]).execute()
    # Insert (not upsert) deliberately fires trg_reset_approval_on_new_prediction (§2.4)
    # for every row, forcing re-review if this patient was already approved.

    return {
        "patient_id": patient_id,
        "predictions": [p.model_dump() for p in predictions],
        "approval_reset": approval_was_reset,
    }