# Low-Level Design (LLD) — v2
AI-Assisted Treatment Recommendation System — Prototype

Companion to HLD v2. Written so a coding agent (OpenCode) can implement directly — exact folder
structure, exact schemas, exact SQL, exact prompts, and code (not just pseudocode) for every
non-trivial piece of logic. Depth is weighted toward the AI/extraction/prediction pipeline.

**Changes from LLD v1:** (1) `patients.current_condition` added, (2) `treatment_predictions`
gains `improvement_band` and `confidence_score`, (3) confidence is a static per-rule value, never
computed at runtime, (4) multi-treatment comparison/ranking logic explicitly out of scope, (5)
Realtime removed in favor of fixed 3-second polling, (6) all pseudocode tightened toward
copy-pasteable code, (7) an explicit non-goals list added so the agent does not extend scope.

**Non-goals — do not implement:** Supabase Realtime subscriptions; a treatment-ranking/scoring
algorithm across multiple treatments; image-based surgery-site localization; any table, column,
or endpoint not listed below; any retry/backoff queue; any auth flow beyond Supabase email/password.

---

## 1. Repository Structure

```
project-root/
├── frontend/                          # Next.js app
│   ├── app/
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   └── signup/page.tsx
│   │   ├── patient/
│   │   │   ├── profile/page.tsx       # profile form
│   │   │   ├── upload/page.tsx        # document upload
│   │   │   ├── dashboard/page.tsx     # status tracker + final plan
│   │   ├── doctor/
│   │   │   ├── queue/page.tsx         # pending approvals list
│   │   │   └── review/[patientId]/page.tsx  # comparison view + approve/reject
│   │   └── layout.tsx
│   ├── lib/
│   │   ├── supabaseClient.ts
│   │   ├── uploadValidation.ts        # client-side file type/size checks
│   │   ├── statusPolling.ts           # NEW: 3s polling hook (replaces Realtime)
│   │   └── api.ts                     # thin wrapper for the 3 FastAPI calls; attaches user JWT
│   ├── components/
│   │   ├── UploadForm.tsx
│   │   ├── ProfileForm.tsx
│   │   ├── StatusTracker.tsx
│   │   ├── TreatmentComparisonTable.tsx
│   │   ├── SimilarPatientsPanel.tsx
│   │   └── ApprovalActions.tsx
│   └── package.json
│
├── backend/                           # FastAPI app
│   ├── main.py                        # app init, routers mounted
│   ├── routers/
│   │   ├── extract.py                 # POST /extract/{document_id}
│   │   ├── predict.py                 # POST /predict/{patient_id}
│   │   └── similar.py                 # POST /similar/{patient_id}
│   ├── services/
│   │   ├── gemini_service.py          # Gemini client — document extraction (OCR+fields in one
│   │   │                              #   multimodal call) + treatment explanation text
│   │   ├── extraction_schema.py       # Pydantic models for extracted fields
│   │   ├── heuristic_engine.py        # rule-based outcome bands + confidence_score
│   │   ├── embedding_service.py       # sentence-transformers wrapper
│   │   ├── auth_service.py            # JWT verification + ownership/role checks
│   │   └── supabase_client.py         # server-side Supabase client (secret key, from .env)
│   ├── models/
│   │   └── schemas.py                 # request/response Pydantic models
│   ├── config.py                      # env var loading
│   ├── requirements.txt
│   └── .env.example
│
└── supabase/
    ├── migrations/
    │   ├── 0001_init_tables.sql
    │   ├── 0002_enable_pgvector.sql
    │   ├── 0003_rls_policies.sql
    │   └── 0004_approval_reset_trigger.sql
    └── seed/
        └── synthetic_patients.sql
```

---

## 2. Database — Full DDL

### 2.1 Extensions & Tables

```sql
-- 0002_enable_pgvector.sql
create extension if not exists vector;
create extension if not exists pgcrypto; -- for gen_random_uuid()
```

```sql
-- 0001_init_tables.sql
create table patients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  age int check (age > 0 and age < 130),
  gender text check (gender in ('male', 'female', 'other')),
  is_pregnant boolean default false,
  is_diabetic boolean default false,
  current_condition text,                 -- NEW: free-text current disease/defect field
  pulse int check (pulse > 0 and pulse < 300),
  lifestyle_healthy boolean,
  allergies text[] default '{}',
  created_at timestamptz default now(),
  unique(user_id)
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  doc_type text not null check (doc_type in ('blood_report', 'surgery_report', 'medical_history')),
  storage_path text not null,
  file_mime_type text not null check (file_mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'processing', 'done', 'failed')),
  raw_ocr_text text,  -- optional: Gemini's transcription of the document, if the extraction
                      -- prompt is asked to return it alongside structured fields (§5.1); not a
                      -- separate OCR call/provider
  created_at timestamptz default now()
);
create index idx_documents_patient on documents(patient_id);

create table extracted_fields (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  field_name text not null,
  field_value text,
  confidence float check (confidence >= 0 and confidence <= 1),
  manually_corrected boolean default false,
  created_at timestamptz default now()
);
create index idx_extracted_fields_document on extracted_fields(document_id);

create table treatment_predictions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  treatment_name text not null,
  risk_band text check (risk_band in ('low', 'medium', 'high')),
  success_band text check (success_band in ('low', 'medium', 'high')),
  side_effect_band text check (side_effect_band in ('low', 'medium', 'high')),
  improvement_band text check (improvement_band in ('low', 'medium', 'high')),  -- NEW
  confidence_score float check (confidence_score >= 0 and confidence_score <= 1), -- NEW, static per rule
  explanation text,
  rule_id text,  -- which heuristic rule produced this row, for traceability
  created_at timestamptz default now()
);
create index idx_predictions_patient on treatment_predictions(patient_id);

create table patient_embeddings (
  patient_id uuid primary key references patients(id) on delete cascade,
  embedding vector(384),
  updated_at timestamptz default now()
);
create index idx_embeddings_vector on patient_embeddings
  using ivfflat (embedding vector_cosine_ops) with (lists = 50);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  doctor_id uuid references auth.users(id),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  doctor_notes text,
  decided_at timestamptz,
  created_at timestamptz default now(),
  unique(patient_id)  -- one active approval record per patient for the prototype
);
```

**Change log vs. v1 DDL:** `patients.current_condition` added (nullable text);
`documents.file_mime_type`/`file_size_bytes` are now `not null` with inline `check` constraints
instead of unconstrained columns, so bad data cannot reach the row at all;
`treatment_predictions` gains `improvement_band` and `confidence_score`. No columns removed.

### 2.2 Role Claim

`role` is set in the user's `app_metadata` (`'patient'` or `'doctor'`) at signup/provisioning
time via the Supabase Admin API. Doctors are not self-service signups — seed manually or via an
admin script.

### 2.3 RLS Policies

```sql
-- 0003_rls_policies.sql
alter table patients enable row level security;
alter table documents enable row level security;
alter table extracted_fields enable row level security;
alter table treatment_predictions enable row level security;
alter table patient_embeddings enable row level security;
alter table approvals enable row level security;

-- Patients: own row only
create policy "patients_select_own" on patients for select
  using (user_id = auth.uid());
create policy "patients_insert_own" on patients for insert
  with check (user_id = auth.uid());
create policy "patients_update_own" on patients for update
  using (user_id = auth.uid());

-- Doctors: read all patients
create policy "doctors_select_all_patients" on patients for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'doctor');

-- Documents: patient owns via patients.user_id; doctor reads all
create policy "documents_patient_own" on documents for all
  using (exists (select 1 from patients p where p.id = documents.patient_id and p.user_id = auth.uid()));
create policy "documents_doctor_read" on documents for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'doctor');

-- extracted_fields: same pattern, plus doctors can UPDATE (manual correction)
create policy "extracted_fields_patient_read" on extracted_fields for select
  using (exists (
    select 1 from documents d join patients p on p.id = d.patient_id
    where d.id = extracted_fields.document_id and p.user_id = auth.uid()
  ));
create policy "extracted_fields_doctor_all" on extracted_fields for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'doctor');

-- treatment_predictions: patient reads own, doctor reads all
create policy "predictions_patient_read" on treatment_predictions for select
  using (exists (select 1 from patients p where p.id = treatment_predictions.patient_id and p.user_id = auth.uid()));
create policy "predictions_doctor_read" on treatment_predictions for select
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'doctor');

-- approvals: patient reads own; doctor reads/writes all
create policy "approvals_patient_read" on approvals for select
  using (exists (select 1 from patients p where p.id = approvals.patient_id and p.user_id = auth.uid()));
create policy "approvals_doctor_all" on approvals for all
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'doctor');
```

Note: the FastAPI backend uses the Supabase **secret key** (new naming; equivalent to the legacy
service_role key — bypasses RLS) since it writes extraction/prediction results for any patient.
RLS protects only the frontend's direct Supabase calls — the backend does its own auth check
instead (§11). This key is read from `SUPABASE_SECRET_KEY` in `backend/.env` (§10) — never
hardcoded, never committed, never sent to the frontend.

### 2.4 Approval Reset Trigger

Fixes: a doctor correction on `extracted_fields`, or a regenerated `treatment_predictions` row,
must reset an already-`approved` approval back to `pending` — enforced at the data layer so it
holds even if frontend/backend code forgets to handle it.

```sql
-- 0004_approval_reset_trigger.sql
create or replace function reset_approval_on_change()
returns trigger
language plpgsql
security definer
as $$
declare
  target_patient_id uuid;
begin
  if TG_TABLE_NAME = 'extracted_fields' then
    select d.patient_id into target_patient_id
    from documents d
    where d.id = NEW.document_id;
  elsif TG_TABLE_NAME = 'treatment_predictions' then
    target_patient_id := NEW.patient_id;
  end if;

  if target_patient_id is not null then
    update approvals
    set status = 'pending', decided_at = null
    where patient_id = target_patient_id and status = 'approved';
  end if;

  return NEW;
end;
$$;

-- Fires when a doctor manually corrects an extracted field after approval
create trigger trg_reset_approval_on_field_correction
  after update of field_value, manually_corrected on extracted_fields
  for each row
  when (NEW.manually_corrected = true)
  execute function reset_approval_on_change();

-- Fires when a fresh prediction row is inserted for a patient that was already approved
create trigger trg_reset_approval_on_new_prediction
  after insert on treatment_predictions
  for each row
  execute function reset_approval_on_change();
```

Behavior: the backend's delete-then-insert pattern for `/predict` (§6.2) always fires
`trg_reset_approval_on_new_prediction` for every fresh row. The `extracted_fields` trigger only
fires on doctor-made manual corrections (`manually_corrected = true`), not on the initial
AI-populated insert.

---

## 3. Backend — API Contracts

All three endpoints require `Authorization: Bearer <supabase_jwt>`. See §11 for the shared
verification logic used by all three routers.

### 3.1 `POST /extract/{document_id}`

Response 200:
```json
{
  "document_id": "uuid",
  "status": "done",
  "fields_extracted": 4,
  "fields_flagged_low_confidence": 1
}
```
Response 401 (missing/invalid JWT): `{ "error": "unauthorized", "detail": "Missing or invalid authentication token" }`
Response 403: `{ "error": "forbidden", "detail": "You do not have access to this document" }`
Response 415: `{ "error": "unsupported_file_type", "detail": "Only PDF, JPEG, and PNG files are supported" }`
Response 422: `{ "document_id": "uuid", "status": "failed", "reason": "llm_output_schema_invalid" }`

### 3.2 `POST /predict/{patient_id}`

Response 200:
```json
{
  "patient_id": "uuid",
  "predictions": [
    {
      "treatment_name": "Metformin (first-line)",
      "risk_band": "low",
      "success_band": "high",
      "side_effect_band": "low",
      "improvement_band": "high",
      "confidence_score": 0.85,
      "explanation": "Standard first-line option; no flagged interactions with current profile.",
      "rule_id": "diabetes_metformin_default"
    }
  ],
  "approval_reset": false
}
```
`approval_reset` is `true` when this run flipped an existing approved approval back to `pending`.
Response 401/403: same shape as §3.1.

### 3.3 `POST /similar/{patient_id}`

Response 200:
```json
{
  "patient_id": "uuid",
  "matches": [
    {
      "matched_patient_id": "uuid",
      "similarity_score": 0.87,
      "approved_treatment": "Metformin (first-line)",
      "outcome_notes": "approved, no complications on record"
    }
  ]
}
```
Response 401/403: same shape as §3.1.

### 3.4 Shared Error Format

Standard HTTP codes: 401 (missing/invalid auth token), 403 (authenticated but not authorized for
this resource), 404 (patient/document not found), 415 (unsupported upload file type), 422
(validation/schema failure), 502 (upstream Gemini API failure), 500 (unexpected).
`{ "error": "string_code", "detail": "human readable message" }`

---

## 4. Backend — Pydantic Models (`models/schemas.py`)

```python
from pydantic import BaseModel, Field
from typing import Optional, Literal

class ExtractedLabFields(BaseModel):
    hba1c: Optional[float] = None
    fasting_glucose: Optional[float] = None
    postprandial_glucose: Optional[float] = None
    date_of_test: Optional[str] = None

class ExtractedSurgeryFields(BaseModel):
    procedure_type: Optional[str] = None
    site: Optional[str] = None
    date: Optional[str] = None
    notes: Optional[str] = None

class FieldWithConfidence(BaseModel):
    field_name: str
    field_value: Optional[str]
    confidence: float = Field(ge=0, le=1)

class ExtractionResult(BaseModel):
    fields: list[FieldWithConfidence]

class TreatmentPrediction(BaseModel):
    treatment_name: str
    risk_band: Literal["low", "medium", "high"]
    success_band: Literal["low", "medium", "high"]
    side_effect_band: Literal["low", "medium", "high"]
    improvement_band: Literal["low", "medium", "high"]   # NEW
    confidence_score: float = Field(ge=0, le=1)           # NEW — static, from rule table only
    explanation: str
    rule_id: str

class SimilarityMatch(BaseModel):
    matched_patient_id: str
    similarity_score: float
    approved_treatment: Optional[str]
    outcome_notes: Optional[str]

class AuthenticatedCaller(BaseModel):
    """Populated by auth_service.verify_caller() — see §11."""
    user_id: str
    role: Literal["patient", "doctor"]
    patient_id: Optional[str] = None  # resolved only for role == "patient"
```

---

## 5. AI Pipeline — Exact Prompt Templates

All extraction prompts below are sent to Gemini as a **multimodal request**: the document file
(image or PDF, fetched from Supabase Storage) is attached directly alongside the text prompt —
there is no separate OCR step or raw-text input. Gemini reads the document and returns
structured JSON in a single call.

### 5.1 Extraction Prompt (blood report)
```
System: You are a medical document field extractor. You read the attached document
image/PDF directly. You extract only explicitly stated values. You never infer,
estimate, or calculate a value that is not directly present in the document.
Respond with valid JSON only, no prose, no markdown fences.

User: [document image/PDF attached]
Extract the following fields from the attached lab report.
If a field is not explicitly present, return null for it. For each field also
return a confidence score between 0 and 1 reflecting how clearly it was stated.

Fields: hba1c, fasting_glucose, postprandial_glucose, date_of_test

Respond in this exact JSON shape:
{
  "fields": [
    {"field_name": "hba1c", "field_value": "<value or null>", "confidence": <0-1>},
    {"field_name": "fasting_glucose", "field_value": "<value or null>", "confidence": <0-1>},
    {"field_name": "postprandial_glucose", "field_value": "<value or null>", "confidence": <0-1>},
    {"field_name": "date_of_test", "field_value": "<value or null>", "confidence": <0-1>}
  ]
}
```

### 5.2 Extraction Prompt (surgery report)
```
System: same as above, applied to surgical/discharge notes. Do not attempt
spatial or image-based localization — read stated text/notes in the document only.

User: [document image/PDF attached]
Extract: procedure_type, site, date, notes (one-line summary).
[same JSON contract as above]
```

Post-processing (backend, not LLM): parse with `json.loads`, validate against `ExtractionResult`.
On `ValidationError` → set `documents.extraction_status = 'failed'`, return 422. On success →
replace `extracted_fields` rows for this document (§6.1). A field with `confidence < 0.6` is
still saved but rendered by the frontend with a "please verify" flag.

### 5.3 Explanation Prompt (used in `/predict`)
```
System: You are drafting a plain-language explanation for a doctor reviewing
an AI-suggested treatment option. You are explaining a rule-based estimate,
not making a new clinical judgment. Do not state or imply a specific
probability number, and do not invent a confidence value — confidence_score
is supplied to you already and must not be restated as a different number.
2-3 sentences maximum.

User: Patient profile summary: {profile_summary}
Treatment: {treatment_name}
Rule fired: {rule_id} → risk={risk_band}, success={success_band},
side_effects={side_effect_band}, improvement={improvement_band}

Write a short explanation of why this treatment produced these bands, referencing
the specific patient factors that mattered (e.g. diabetes status, age, allergies,
current_condition).
```

---

## 6. Router Logic — Idempotent Writes & Status Transitions

### 6.1 `routers/extract.py`

```python
MAX_UPLOAD_BYTES = 10485760  # 10 MB, exact — see HLD §0.3
ACCEPTED_MIME_TYPES = ("application/pdf", "image/jpeg", "image/png")

@router.post("/extract/{document_id}")
async def extract(document_id: str, caller: AuthenticatedCaller = Depends(verify_caller)):
    document = supabase.table("documents").select("*").eq("id", document_id).single().execute()
    if document is None:
        raise HTTPException(404, "document_not_found")
    authorize_document_access(caller, document)  # §11 — 403 if not owner/doctor

    if document.file_mime_type not in ACCEPTED_MIME_TYPES:
        raise HTTPException(415, "unsupported_file_type")
    if document.file_size_bytes > MAX_UPLOAD_BYTES:
        raise HTTPException(415, "file_too_large")

    supabase.table("documents").update({"extraction_status": "processing"}).eq("id", document_id).execute()

    try:
        file_bytes = supabase.storage.from_("reports").download(document.storage_path)
        gemini_response = gemini_service.extract_fields(
            file_bytes=file_bytes,
            mime_type=document.file_mime_type,
            doc_type=document.doc_type,
        )  # single multimodal call: document in, structured JSON out (§5.1/§5.2)
        result = ExtractionResult.model_validate_json(gemini_response)  # raises on schema mismatch
    except GeminiProviderError:
        supabase.table("documents").update({"extraction_status": "failed"}).eq("id", document_id).execute()
        raise HTTPException(502, "upstream_provider_failure")
    except ValidationError:
        supabase.table("documents").update({"extraction_status": "failed"}).eq("id", document_id).execute()
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

    supabase.table("documents").update({"extraction_status": "done"}).eq("id", document_id).execute()
    return {
        "document_id": document_id,
        "status": "done",
        "fields_extracted": len(result.fields),
        "fields_flagged_low_confidence": sum(1 for f in result.fields if f.confidence < 0.6),
    }
```

### 6.2 `routers/predict.py`

```python
@router.post("/predict/{patient_id}")
async def predict(patient_id: str, caller: AuthenticatedCaller = Depends(verify_caller)):
    patient = supabase.table("patients").select("*").eq("id", patient_id).single().execute()
    if patient is None:
        raise HTTPException(404, "patient_not_found")
    authorize_patient_access(caller, patient)  # §11 — 403 if not owner/doctor

    extracted = fetch_all_extracted_fields_for_patient(patient_id)  # join through documents
    predictions = heuristic_engine.evaluate(patient)  # §7 — includes improvement_band, confidence_score

    # Idempotent write: replace prior predictions rather than appending.
    supabase.table("treatment_predictions").delete().eq("patient_id", patient_id).execute()
    supabase.table("treatment_predictions").insert([p.model_dump() for p in predictions]).execute()
    # Insert (not upsert) deliberately fires trg_reset_approval_on_new_prediction (§2.4)
    # for every row, forcing re-review if this patient was already approved.

    existing_approval = supabase.table("approvals").select("status").eq("patient_id", patient_id).maybe_single().execute()
    approval_was_reset = bool(existing_approval and existing_approval.status == "approved")
    # (the reset already happened via the DB trigger; this is a read-back to report it)

    return {
        "patient_id": patient_id,
        "predictions": [p.model_dump() for p in predictions],
        "approval_reset": approval_was_reset,
    }
```

---

## 7. Heuristic Engine — `services/heuristic_engine.py`

Confidence is a **static, human-authored value per rule row** — never computed, averaged, or
inferred at runtime by the LLM or by application logic. This is a hard constraint for the coding
agent: do not add a formula for `confidence_score`.

```python
# A small, explicit rule table. Every row is auditable — rule_id traces back
# to exactly why a set of bands was assigned. Extend this table freely; never
# let the LLM assign bands or confidence_score directly.
RULES = [
    {
        "rule_id": "diabetes_metformin_default",
        "condition": lambda p: p.is_diabetic,
        "treatment_name": "Metformin (first-line)",
        "risk_band": "low",
        "success_band": "high",
        "side_effect_band": "low",
        "improvement_band": "high",
        "confidence_score": 0.85,
    },
    {
        "rule_id": "diabetes_pregnant_flag",
        "condition": lambda p: p.is_diabetic and p.is_pregnant,
        "treatment_name": "Metformin (first-line)",
        "risk_band": "medium",       # overrides default — pregnancy changes the picture
        "success_band": "medium",
        "side_effect_band": "medium",
        "improvement_band": "medium",
        "confidence_score": 0.6,     # lower confidence — fewer safety data points modeled
    },
    {
        "rule_id": "diabetes_elevated_pulse_flag",
        "condition": lambda p: p.is_diabetic and p.pulse and p.pulse > 100,
        "treatment_name": "Metformin (first-line)",
        "risk_band": "medium",
        "success_band": "medium",
        "side_effect_band": "medium",
        "improvement_band": "medium",
        "confidence_score": 0.65,
    },
    {
        "rule_id": "allergy_conflict_check",
        "condition": lambda p, treatment: treatment_conflicts_with_allergies(p.allergies, treatment),
        "risk_band": "high",
        "success_band": "low",
        "side_effect_band": "high",
        "improvement_band": "low",
        "confidence_score": 0.9,     # allergy conflicts are the most certain signal available
    },
    # Add more rules per treatment/condition combination as the demo dataset grows.
    # Every new rule MUST set all five output fields explicitly — no defaults, no inheritance.
]

def evaluate(patient) -> list[TreatmentPrediction]:
    results = []
    for rule in RULES:
        if rule["condition"](patient):
            explanation = call_llm_explanation(patient, rule)  # §5.3 prompt
            results.append(TreatmentPrediction(
                treatment_name=rule["treatment_name"],
                risk_band=rule["risk_band"],
                success_band=rule["success_band"],
                side_effect_band=rule["side_effect_band"],
                improvement_band=rule["improvement_band"],
                confidence_score=rule["confidence_score"],
                explanation=explanation,
                rule_id=rule["rule_id"],
            ))
    # If more than one rule matches the same treatment_name, keep the row with
    # the highest risk_band (most conservative), never average bands or scores.
    # Out of scope (HLD §0.2): ranking or comparing across DIFFERENT treatment_names.
    return deduplicate_keep_highest_risk(results)
```

**Priority rule (unchanged, restated precisely):** when multiple matched rules share the same
`treatment_name`, `deduplicate_keep_highest_risk` keeps only the one with the highest `risk_band`
(`high` > `medium` > `low`); it does not average or blend `confidence_score` or any band. This is
a safety-relevant rule — implement exactly as stated, do not "improve" it.

---

## 8. Similarity — `services/embedding_service.py`

```python
from sentence_transformers import SentenceTransformer

model = SentenceTransformer('all-MiniLM-L6-v2')  # 384-dim, matches schema

def build_profile_text(patient) -> str:
    return (
        f"Age {patient.age}, {patient.gender}, "
        f"{'pregnant' if patient.is_pregnant else 'not pregnant'}, "
        f"{'diabetic' if patient.is_diabetic else 'non-diabetic'}, "
        f"current condition: {patient.current_condition or 'none reported'}, "
        f"pulse {patient.pulse}, "
        f"lifestyle {'healthy' if patient.lifestyle_healthy else 'unhealthy'}, "
        f"allergies: {', '.join(patient.allergies) or 'none'}"
    )

def embed_and_store(patient):
    text = build_profile_text(patient)
    vector = model.encode(text).tolist()
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
    }).execute()
```

Supporting Postgres function (add to a migration):
```sql
create or replace function match_similar_patients(query_patient_id uuid, match_count int)
returns table(matched_patient_id uuid, similarity_score float)
language sql stable as $$
  select pe2.patient_id, 1 - (pe1.embedding <=> pe2.embedding) as similarity_score
  from patient_embeddings pe1
  join patient_embeddings pe2 on pe2.patient_id != pe1.patient_id
  where pe1.patient_id = query_patient_id
  order by pe1.embedding <=> pe2.embedding
  limit match_count;
$$;
```

---

## 9. Frontend — Key Component Contracts

| Component | Props (in) | Emits |
|---|---|---|
| `UploadForm` | `patientId`, `docType` | validates file type/size client-side (§12) before upload; on success: inserts `documents` row (including `file_mime_type`, `file_size_bytes`), calls `POST /extract/{id}` with the user's JWT attached |
| `StatusTracker` | `patientId` | polls `documents` (incl. `processing`) + `approvals` every 3s via `statusPolling.ts` (see below) — Realtime is NOT used |
| `TreatmentComparisonTable` | `predictions: TreatmentPrediction[]` (now includes `improvement_band`, `confidence_score`) | none (read-only) |
| `SimilarPatientsPanel` | `matches: SimilarityMatch[]` | none (read-only) |
| `ApprovalActions` | `patientId`, `doctorId` | on click: updates `approvals` row directly via Supabase client |

`lib/statusPolling.ts` (replaces the Realtime subscription from v1):
```ts
export function useStatusPolling(patientId: string, intervalMs = 3000) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [approval, setApproval] = useState<ApprovalRow | null>(null);

  useEffect(() => {
    let active = true;
    async function poll() {
      const { data: docs } = await supabase.from("documents").select("*").eq("patient_id", patientId);
      const { data: appr } = await supabase.from("approvals").select("*").eq("patient_id", patientId).maybeSingle();
      if (!active) return;
      setDocuments(docs ?? []);
      setApproval(appr ?? null);
      const stillPending = (docs ?? []).some(d => ["pending", "processing"].includes(d.extraction_status))
        || appr?.status === "pending";
      if (stillPending) setTimeout(poll, intervalMs);
    }
    poll();
    return () => { active = false; };
  }, [patientId, intervalMs]);

  return { documents, approval };
}
```

`api.ts` wrapper — JWT attached to every backend call:
```ts
async function callBackend(path: string, method = "POST") {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${session?.access_token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

---

## 10. Environment Variables

**Rule for the coding agent — no exceptions:** every credential in this table is read from
`.env` (backend) or `.env.local` (frontend) via each framework's standard env-loading mechanism
(`os.getenv(...)` / `python-dotenv` in FastAPI; Next.js's built-in `.env.local` support). No key,
URL, or secret is ever hardcoded in source, committed to git, or passed as a literal string
anywhere in `frontend/` or `backend/`. Both `backend/.env` and `frontend/.env.local` must be
listed in `.gitignore`; only `backend/.env.example` and an equivalent frontend example file
(with empty/placeholder values) are committed.

**Naming note:** Supabase now issues two key pairs. Use the **new naming** below
(`publishable` / `secret`) — not the legacy `anon` / `service_role` names, which map 1:1 to the
same roles but are being phased out. If a project only shows legacy keys, the legacy `anon` key
is equivalent to `publishable`, and the legacy `service_role` key is equivalent to `secret`.

```
# backend/.env
SUPABASE_URL=
SUPABASE_SECRET_KEY=              # server-only; bypasses RLS — never expose to frontend
GEMINI_API_KEY=                   # single key, reused for document extraction (OCR+fields)
                                   # and treatment explanation text — no separate OCR provider
LLM_MODEL_NAME=gemini-2.0-flash   # Gemini API (Google AI Studio, free tier)
EMBEDDING_MODEL_NAME=all-MiniLM-L6-v2
MAX_UPLOAD_BYTES=10485760

# frontend/.env.local
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=   # safe to expose in browser; RLS-scoped
NEXT_PUBLIC_BACKEND_URL=
```

`backend/services/supabase_client.py` and `frontend/lib/supabaseClient.ts` are the **only** two
places a Supabase client is constructed. Every other file that needs Supabase access imports the
client from one of these two modules — it never re-reads env vars or re-instantiates a client
elsewhere.

---

## 11. Auth Verification — `services/auth_service.py`

The backend holds the **secret key** (bypasses RLS), so it must independently verify every
caller. Shared FastAPI dependency used by all three routers.

```python
from fastapi import Header, HTTPException

def verify_caller(authorization: str = Header(None)) -> AuthenticatedCaller:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, detail="Missing or invalid authentication token")
    token = authorization.removeprefix("Bearer ")
    try:
        # Verifies signature + expiry against Supabase Auth. This is purely a
        # "who is this" check, separate from the secret-key client used
        # afterwards to actually read/write data.
        user = supabase_admin.auth.get_user(token)
    except Exception:
        raise HTTPException(401, detail="Missing or invalid authentication token")

    role = user.app_metadata.get("role")
    if role not in ("patient", "doctor"):
        raise HTTPException(401, detail="Missing or invalid authentication token")

    patient_id = None
    if role == "patient":
        record = supabase_admin.table("patients").select("id").eq("user_id", user.id).maybe_single().execute()
        patient_id = record.id if record else None

    return AuthenticatedCaller(user_id=user.id, role=role, patient_id=patient_id)

def authorize_patient_access(caller: AuthenticatedCaller, patient) -> None:
    if caller.role == "doctor":
        return
    if caller.role == "patient" and caller.patient_id == patient.id:
        return
    raise HTTPException(403, detail="You do not have access to this patient record")

def authorize_document_access(caller: AuthenticatedCaller, document) -> None:
    if caller.role == "doctor":
        return
    if caller.role == "patient" and caller.patient_id == document.patient_id:
        return
    raise HTTPException(403, detail="You do not have access to this document")
```

Used as a FastAPI dependency in every router:
```python
@router.post("/similar/{patient_id}")
async def similar(patient_id: str, caller: AuthenticatedCaller = Depends(verify_caller)):
    patient = fetch_patient_or_404(patient_id)
    authorize_patient_access(caller, patient)
    ...
```

---

## 12. Upload Validation

Client-side (`lib/uploadValidation.ts`):
```ts
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
```
`UploadForm.tsx` calls `validateUpload(file)` before uploading to Storage; on failure it shows the
error inline and does not upload. On success, `file.type` and `file.size` are written to
`documents.file_mime_type`/`documents.file_size_bytes` at insert time.

Server-side (`backend/routers/extract.py`, §6.1): before calling Gemini, the backend re-checks
`document.file_mime_type` against `ACCEPTED_MIME_TYPES` and `document.file_size_bytes` against
`MAX_UPLOAD_BYTES`, returning 415 if either check fails. This is deliberate defense-in-depth — the
client check can be bypassed by calling the API directly.

Storage bucket policy (second line of defense, optional): the Supabase Storage bucket used for
reports can additionally restrict accepted MIME types at the bucket-policy level.

---

## 13. Build Order (with per-step acceptance criteria)

1. Run `0001_init_tables.sql`, `0002_enable_pgvector.sql`, `0003_rls_policies.sql`,
   `0004_approval_reset_trigger.sql` + the `match_similar_patients` function.
   **Done when:** all four migrations apply cleanly against a fresh Supabase project with no errors.
2. Seed 2 test users (one patient role, one doctor role via `app_metadata`).
   **Done when:** both users can log in and `auth.jwt() ->> 'role'` resolves correctly for each.
3. Build frontend auth + profile form (including `current_condition`) + upload (with
   `uploadValidation.ts` wired in).
   **Done when:** rows land correctly in Supabase with RLS working, tested as both roles; an
   oversized or wrong-type file is rejected client-side before any network call.
4. Build `auth_service.py` (`verify_caller`, `authorize_patient_access`,
   `authorize_document_access`) and wire it as a dependency into all three routers **before**
   writing any endpoint business logic.
   **Done when:** calling any of the three endpoints with no `Authorization` header returns 401,
   and calling with a valid token for the wrong patient returns 403.
5. Build `/extract` end-to-end with one hardcoded sample `ExtractionResult` JSON response before
   wiring real Gemini calls.
   **Done when:** the endpoint transitions `pending → processing → done`, and calling it twice on
   the same `document_id` leaves exactly one row per field in `extracted_fields` (no duplicates).
6. Wire real Gemini API calls in `gemini_service.py` (§5.1/§5.2) — document image/PDF sent
   directly as multimodal input, no separate OCR provider.
   **Done when:** a real uploaded PDF/image passes through the same extraction path as step 5
   unchanged and produces correctly populated `extracted_fields` rows.
7. Build `heuristic_engine.py` with the rule table (§7), wire `/predict`, including the
   idempotent replace and the approval-reset behavior.
   **Done when:** running `/predict` against a pre-approved test patient flips
   `approvals.status` to `pending` and the response has `approval_reset: true`; every returned
   prediction includes all five fields (`risk_band`, `success_band`, `side_effect_band`,
   `improvement_band`, `confidence_score`).
8. Build `embedding_service.py` + `match_similar_patients`, wire `/similar`.
   **Done when:** querying similarity against a seeded patient set returns `top_k` matches
   excluding self, ordered by similarity.
9. Build Doctor Queue + Comparison View + Approve/Reject.
   **Done when:** a manual correction on an approved patient's `extracted_fields` flips
   `approvals.status` back to `pending` via the trigger (verified directly against the DB, not
   just the UI).
10. Build Patient Dashboard final view.
    **Done when:** it is verified impossible for the dashboard to render `treatment_predictions`
    for a patient whose `approvals.status` is not exactly `'approved'`.
11. Seed `synthetic_patients.sql` with 8–10 fake patients (profile + embeddings) for the
    similarity panel demo.
    **Done when:** `/similar` against any seeded patient returns non-empty matches.

This LLD is intentionally scoped to match the HLD and blueprint — no production concerns
(queueing, monitoring, compliance-grade audit, multi-treatment ranking, Realtime) have been
added. Everything else — schema shape, endpoint set, prompt templates, rule engine, deployment
model — matches the original design plus the additive fixes listed at the top of this document.
Extend deliberately, not by default, when this prototype graduates.
