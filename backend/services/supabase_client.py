# LLD v2 §10 — this is the ONLY place the server-side Supabase client is constructed.
# Every other backend file imports from here; it never re-reads env vars elsewhere.
from supabase import create_client

from config import SUPABASE_SECRET_KEY, SUPABASE_URL

supabase = create_client(SUPABASE_URL, SUPABASE_SECRET_KEY)
# LLD v2 §11 names the secret-key client `supabase_admin`. Same client instance —
# the secret key bypasses RLS, so it can also validate caller JWTs via the Auth API.
supabase_admin = supabase


def get_maybe_single(table: str, column: str, value) -> dict | None:
    """Fetch at most one row by an exact column match, or None.

    NOTE: this supabase-py version returns None from maybe_single().execute() when no
    row matches (not an APIResponse), so callers must guard on the response itself.
    """
    response = supabase.table(table).select("*").eq(column, value).maybe_single().execute()
    return response.data if response is not None else None