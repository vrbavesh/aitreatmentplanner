# LLD v2 §3/§8 — POST /similar/{patient_id}
from fastapi import APIRouter, Depends, HTTPException

from models.schemas import AuthenticatedCaller, Patient
from services.auth_service import authorize_patient_access, verify_caller
from services.embedding_service import embed_and_store, query_similar
from services.supabase_client import get_maybe_single, supabase

router = APIRouter()

TOP_K = 5


def _enrich_match(match: dict) -> dict:
    """Attach approved_treatment + outcome_notes for a matched patient (LLD §3.3 contract)."""
    matched_patient_id = match["matched_patient_id"]
    approval = get_maybe_single("approvals", "patient_id", matched_patient_id)
    approved_treatment = None
    outcome_notes = None
    if approval and approval["status"] == "approved":
        predictions = (
            supabase.table("treatment_predictions")
            .select("treatment_name")
            .eq("patient_id", matched_patient_id)
            .execute()
            .data
        )
        if predictions:
            approved_treatment = predictions[0]["treatment_name"]
        outcome_notes = approval.get("doctor_notes") or "approved, no complications on record"
    return {
        "matched_patient_id": matched_patient_id,
        "similarity_score": match["similarity_score"],
        "approved_treatment": approved_treatment,
        "outcome_notes": outcome_notes,
    }


@router.post("/similar/{patient_id}")
async def similar(patient_id: str, caller: AuthenticatedCaller = Depends(verify_caller)):
    patient = get_maybe_single("patients", "id", patient_id)
    if patient is None:
        raise HTTPException(404, detail={"error": "not_found", "detail": "Patient not found"})
    authorize_patient_access(caller, patient)  # §11 — 403 if not owner/doctor

    patient_obj = Patient.from_row(patient)
    embed_and_store(patient_obj)  # upsert this patient's embedding before querying

    matches = query_similar(patient_id, top_k=TOP_K) or []
    return {
        "patient_id": patient_id,
        "matches": [_enrich_match(m) for m in matches],
    }