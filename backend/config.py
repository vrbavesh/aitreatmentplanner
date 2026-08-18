import os

from dotenv import load_dotenv

load_dotenv()

# LLD v2 §10 — all credentials are read from backend/.env only. Never hardcoded.
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SECRET_KEY = os.getenv("SUPABASE_SECRET_KEY", "")  # server-only; bypasses RLS
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")  # single key: extraction (OCR+fields) + explanation
LLM_MODEL_NAME = os.getenv("LLM_MODEL_NAME", "gemini-2.5-flash")
EMBEDDING_MODEL_NAME = os.getenv("EMBEDDING_MODEL_NAME", "all-MiniLM-L6-v2")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", "10485760"))