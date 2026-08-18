# LLD v2 §11 — shared FastAPI dependency used by all three routers.
# The backend holds the secret key (bypasses RLS), so it must independently verify
# every caller before touching any patient's data.
from fastapi import Header, HTTPException

from models.schemas import AuthenticatedCaller
from services.supabase_client import supabase_admin


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail={"error": "unauthorized", "detail": "Missing or invalid authentication token"},
    )


def _forbidden(message: str) -> HTTPException:
    return HTTPException(status_code=403, detail={"error": "forbidden", "detail": message})


def verify_caller(authorization: str = Header(None)) -> AuthenticatedCaller:
    if not authorization or not authorization.startswith("Bearer "):
        raise _unauthorized()
    token = authorization.removeprefix("Bearer ")
    try:
        # Verifies signature + expiry against Supabase Auth. This is purely a
        # "who is this" check, separate from the secret-key client used
        # afterwards to actually read/write data.
        user = supabase_admin.auth.get_user(token).user
    except Exception:
        raise _unauthorized()

    role = (user.app_metadata or {}).get("role")
    if role not in ("patient", "doctor"):
        raise _unauthorized()

    patient_id = None
    if role == "patient":
        record = (
            supabase_admin.table("patients")
            .select("id")
            .eq("user_id", user.id)
            .maybe_single()
            .execute()
        )
        patient_id = record.data["id"] if record.data else None

    return AuthenticatedCaller(user_id=user.id, role=role, patient_id=patient_id)


def authorize_patient_access(caller: AuthenticatedCaller, patient) -> None:
    if caller.role == "doctor":
        return
    if caller.role == "patient" and caller.patient_id == patient["id"]:
        return
    raise _forbidden("You do not have access to this patient record")


def authorize_document_access(caller: AuthenticatedCaller, document) -> None:
    if caller.role == "doctor":
        return
    if caller.role == "patient" and caller.patient_id == document["patient_id"]:
        return
    raise _forbidden("You do not have access to this document")