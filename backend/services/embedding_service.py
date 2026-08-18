# LLD v2 §8 — sentence-transformers embedding service (all-MiniLM-L6-v2, 384-dim).
# Runs inside the FastAPI process — no hosted embedding API needed at prototype scale.
from config import EMBEDDING_MODEL_NAME
from models.schemas import Patient
from services.supabase_client import supabase

# The model is loaded lazily on first use so importing this module (e.g. from the
# heuristic engine for build_profile_text) does not pull the model into memory.
_model = None


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer(EMBEDDING_MODEL_NAME)  # 384-dim, matches schema
    return _model


def build_profile_text(patient: Patient) -> str:
    return (
        f"Age {patient.age}, {patient.gender}, "
        f"{'pregnant' if patient.is_pregnant else 'not pregnant'}, "
        f"{'diabetic' if patient.is_diabetic else 'non-diabetic'}, "
        f"current condition: {patient.current_condition or 'none reported'}, "
        f"pulse {patient.pulse}, "
        f"lifestyle {'healthy' if patient.lifestyle_healthy else 'unhealthy'}, "
        f"allergies: {', '.join(patient.allergies) or 'none'}"
    )


def embed_and_store(patient: Patient) -> list[float]:
    text = build_profile_text(patient)
    vector = _get_model().encode(text).tolist()
    supabase.table("patient_embeddings").upsert({
        "patient_id": patient.id,
        "embedding": vector,
    }).execute()
    return vector


def query_similar(patient_id: str, top_k: int = 5):
    # raw SQL via Supabase RPC, since pgvector cosine search isn't
    # expressible through the JS/py client directly
    return supabase.rpc("match_similar_patients", {
        "query_patient_id": patient_id,
        "match_count": top_k,
    }).execute().data