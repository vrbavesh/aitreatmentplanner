# LLD v2 §6.1 — POST /extract/{document_id}
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from config import MAX_UPLOAD_BYTES
from services.auth_service import authorize_document_access, verify_caller
from services.extraction_schema import ExtractionResult
from services.gemini_service import GeminiProviderError, extract_fields
from services.supabase_client import get_maybe_single, supabase
from models.schemas import AuthenticatedCaller

router = APIRouter()

ACCEPTED_MIME_TYPES = ("application/pdf", "image/jpeg", "image/png")


@router.post("/extract/{document_id}")
async def extract(document_id: str, caller: AuthenticatedCaller = Depends(verify_caller)):
    document = get_maybe_single("documents", "id", document_id)
    if document is None:
        raise HTTPException(404, detail={"error": "not_found", "detail": "Document not found"})
    authorize_document_access(caller, document)  # §11 — 403 if not owner/doctor

    if document["file_mime_type"] not in ACCEPTED_MIME_TYPES:
        raise HTTPException(
            415,
            detail={
                "error": "unsupported_file_type",
                "detail": "Only PDF, JPEG, and PNG files are supported",
            },
        )
    if document["file_size_bytes"] > MAX_UPLOAD_BYTES:
        raise HTTPException(
            415,
            detail={"error": "file_too_large", "detail": "File must be under 10MB."},
        )

    supabase.table("documents").update({"extraction_status": "processing"}).eq(
        "id", document_id
    ).execute()

    try:
        file_bytes = supabase.storage.from_("reports").download(document["storage_path"])
        gemini_response = extract_fields(
            file_bytes=file_bytes,
            mime_type=document["file_mime_type"],
            doc_type=document["doc_type"],
        )  # single multimodal call: document in, structured JSON out (§5.1/§5.2)
        result = ExtractionResult.model_validate_json(gemini_response)  # raises on schema mismatch
    except GeminiProviderError:
        supabase.table("documents").update({"extraction_status": "failed"}).eq(
            "id", document_id
        ).execute()
        raise HTTPException(
            502, detail={"error": "upstream_provider_failure", "detail": "Gemini API call failed"}
        )
    except ValidationError:
        supabase.table("documents").update({"extraction_status": "failed"}).eq(
            "id", document_id
        ).execute()
        return JSONResponse(status_code=422, content={
            "document_id": document_id, "status": "failed", "reason": "llm_output_schema_invalid"
        })

    # Idempotent write: clear prior rows for this document before inserting fresh ones.
    supabase.table("extracted_fields").delete().eq("document_id", document_id).execute()
    supabase.table("extracted_fields").insert([
        {"document_id": document_id, "field_name": f.field_name,
         "field_value": f.field_value, "confidence": f.confidence}
        for f in result.fields
    ]).execute()

    supabase.table("documents").update({"extraction_status": "done"}).eq(
        "id", document_id
    ).execute()
    return {
        "document_id": document_id,
        "status": "done",
        "fields_extracted": len(result.fields),
        "fields_flagged_low_confidence": sum(1 for f in result.fields if f.confidence < 0.6),
    }