# High-Level Design (HLD) — v2
AI-Assisted Treatment Recommendation System — Prototype

**Source of truth chain:** `ai-treatment-recommendation-blueprint.md` → HLD v1 → HLD v2 (this doc).
This revision closes agent-facing ambiguity so it can be handed to an autonomous coding agent
(OpenCode) with minimal risk of scope drift or invented behavior. No new product features were
added. One feature was explicitly deferred (see §0.2).

---

## 0. Instructions for the Coding Agent (read first)

0.1 **Build only what is specified.** If a requirement seems ambiguous or missing, do not invent
behavior — insert a `# TODO(spec-gap): <description>` comment at that location and continue with
the nearest explicit instruction in this document or the LLD. Do not add libraries, services,
tables, columns, or endpoints not named in this HLD/LLD pair.

0.2 **Explicitly deferred (do NOT build now):** multi-treatment side-by-side comparison logic
(the heuristic engine may fire more than one rule, but building a rich "compare N treatments"
UI/ranking layer is deferred to a post-prototype iteration). Everything else in the original
blueprint's 5 features is in scope and detailed below.

0.3 **Canonical naming — use these exact identifiers everywhere** (tables, columns, JSON keys,
env vars). Do not rename, pluralize differently, or re-case anything below. Full schema is in
LLD §2.

| Concept | Canonical name |
|---|---|
| Risk output | `risk_band` |
| Success output | `success_band` |
| Side-effect output | `side_effect_band` |
| Improvement output (NEW) | `improvement_band` |
| Per-treatment confidence (NEW) | `confidence_score` |
| Patient's current disease/defect (NEW) | `current_condition` |
| Max upload size | `MAX_UPLOAD_BYTES = 10485760` (10 MB, exact) |
| Accepted upload MIME types | `application/pdf`, `image/jpeg`, `image/png` (exactly these three, no others) |

0.4 **Status tracking uses polling, not Realtime, by default.** Supabase Realtime is optional
and MUST NOT be implemented unless separately requested. Default: frontend polls
`documents.extraction_status` and `approvals.status` every 3 seconds while a status is `pending`
or `processing`, and stops polling once `done`/`failed`/`approved`/`rejected`. This removes an
ambiguous "optional" branch that an agent could otherwise interpret either way.

0.5 **All credentials come from `.env` / `.env.local` only — never hardcoded, never committed.**
Every API key, URL, and secret named in LLD §10 is read at runtime via each framework's standard
env-loading mechanism. No file in `frontend/` or `backend/` may contain a literal key, URL, or
secret string. `backend/.env` and `frontend/.env.local` are both `.gitignore`d; only
`.env.example` equivalents (empty placeholders) are committed. Use Supabase's current key
naming — `SUPABASE_SECRET_KEY` (backend, bypasses RLS) and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (frontend, RLS-scoped) — not the legacy `service_role`/
`anon` names, though they refer to the same underlying roles.

---

## 1. Purpose & Scope

Build a working end-to-end prototype demonstrating:

`Upload → Extract → Predict → Doctor Approves → Patient Sees Plan`

Two user roles: **Patient** and **Doctor**. One rule shapes the whole design: **no AI output
reaches a patient without doctor approval.** This is enforced at the data layer (RLS + trigger),
not just the UI.

**Out of scope for this prototype** (unchanged from blueprint §1.5/§9, plus §0.2 above): task
queues, API gateway, search infra, model monitoring, container orchestration, secrets management
beyond `.env`, image-based surgery-site localization, ML-trained outcome prediction,
regulatory-grade audit logging, multi-treatment comparison ranking UI, Supabase Realtime,
Docker/Kubernetes.

---

## 2. System Context

Two data paths, by design (blueprint §6):

- **Simple CRUD** (create patient, view documents, view approval status) → Frontend talks to
  Supabase directly. No backend round-trip.
- **AI-heavy operations** (extraction, prediction, similarity) → Frontend calls FastAPI, which
  calls external AI services and writes results back into Supabase.

```
┌─────────────────────────────────────────┐
│ End Users                                │
│ Patient (browser)     Doctor (browser)   │
└───────────────┬───────────────────────────┘
                │ HTTPS
┌───────────────▼───────────────────────────┐
│ Next.js Frontend (Vercel)                 │
│ - Patient portal    - Doctor portal       │
└──────┬────────────────────────┬─────────────┘
       │                        │
direct CRUD via   │   │ AI-heavy operations
Supabase JS client│   │ (extract/predict/similar)
       ▼                        ▼
┌──────────────────────┐   ┌───────────────────────────┐
│ Supabase             │   │ FastAPI Backend           │
│ - Postgres           │◀─▶│ (Render/Railway)          │
│ - pgvector           │   │ - /extract                │
│ - Storage            │   │ - /predict                │
│ - Auth + RLS         │   │ - /similar                │
└──────────────────────┘   └──────────┬─────────────────┘
                                       │
                        ┌────────────▼────────────┐
                        │ External AI Services      │
                        │ - LLM/Vision (Gemini API — │
                        │   Google AI Studio,        │
                        │   free tier) — handles     │
                        │   OCR + extraction in one  │
                        │   multimodal call          │
                        │ - sentence-transformers    │
                        │   (embeddings, local)      │
                        └────────────────────────┘
```

**Trust boundary:** FastAPI uses the Supabase **secret key** (new naming; equivalent to the
legacy service_role key) and therefore bypasses RLS entirely when it writes results. FastAPI is
itself a security boundary and MUST independently verify the caller's identity and role on every
request before touching any patient's data (LLD §3, §11). RLS alone does not protect data
reached through the backend. This key, and every other credential in the system, is loaded from
`.env`/`.env.local` only — never hardcoded in source (LLD §10).

---

## 3. Component Breakdown

### 3.1 Frontend (Next.js + TypeScript)

| Sub-component | Responsibility | Talks to |
|---|---|---|
| Auth pages | Signup/login (patient or doctor) | Supabase Auth |
| Patient Profile Form | Capture age, gender, pregnancy, `is_diabetic`, `current_condition`, pulse, allergies, lifestyle | Supabase (direct insert) |
| Upload Module | Upload blood report / surgery report / medical history to Storage; create `documents` row; validates file type and size client-side before upload (LLD §12) | Supabase Storage + Postgres |
| Status Tracker | Poll `documents.extraction_status` (`pending`/`processing`/`done`/`failed`) and `approvals.status` every 3s per §0.4 | Supabase |
| Patient Dashboard | Read-only view of the approved plan, including `improvement_band` and `confidence_score` per treatment | Supabase (direct select, RLS-scoped to own `user_id`) |
| Doctor Queue | List patients with `approvals.status = 'pending'` | Supabase (RLS-scoped to `role = 'doctor'`) |
| Doctor Comparison View | Render `treatment_predictions` + `patient_embeddings` similarity results side by side (single-treatment display per current scope — see §0.2) | Supabase (direct select) |
| Approve/Reject Action | Update `approvals` row | Supabase (direct update, RLS-restricted) |
| "Trigger AI" buttons | Kick off `/extract`, `/predict`, `/similar` on the backend; forwards the user's Supabase auth JWT with each call | FastAPI |

### 3.2 Backend (FastAPI)

Exactly three endpoints — no others. Each is a thin orchestrator: pull input from Supabase → call
an external AI service → validate/shape the result → write back to Supabase. Supabase is the
single source of truth; the backend is stateless and owns no business data.

Every endpoint runs an auth/authorization check as its **first** step, before any Supabase or
external AI call: the caller's Supabase JWT (forwarded by the frontend) is verified, and the
request proceeds only if the caller is the owning patient or has the doctor role claim.

| Endpoint | Orchestrates |
|---|---|
| `POST /extract/{document_id}` | Verify caller owns the document (or is doctor) → validate file type/size already recorded on upload → fetch document from Storage → single Gemini multimodal call (document image/PDF in, structured JSON out — combines OCR + extraction) → validate JSON → replace any prior `extracted_fields` rows for this document (idempotent) → transition `documents.extraction_status`: `pending → processing → done`/`failed` |
| `POST /predict/{patient_id}` | Verify caller owns the patient record (or is doctor) → fetch patient profile + extracted fields → run rule-based heuristic (produces `risk_band`, `success_band`, `side_effect_band`, `improvement_band`, `confidence_score` per matched rule) → LLM explanation call → replace any prior `treatment_predictions` rows for this patient (idempotent) → if `approvals.status = 'approved'` for this patient, it is reset to `pending` via DB trigger |
| `POST /similar/{patient_id}` | Verify caller owns the patient record (or is doctor) → fetch patient profile → build embedding text → sentence-transformers → upsert `patient_embeddings` → pgvector nearest-neighbor query → return matches (not persisted separately) |

### 3.3 Supabase (Data Platform)

| Feature | Used for |
|---|---|
| Postgres | All structured entities (`patients`, `documents`, `extracted_fields`, `treatment_predictions`, `approvals`, `patient_embeddings`) |
| pgvector | Similarity search over `patient_embeddings.embedding` |
| Storage | Raw uploaded files; bucket policy restricts accepted MIME types as a second line of defense behind client-side validation |
| Auth | Email/password login; `role` claim in `app_metadata` distinguishes patient vs. doctor |
| RLS | Patients see only their own rows; doctors see all patient rows but can only write to `approvals` (and `extracted_fields` for manual correction) |
| Trigger | A trigger on `extracted_fields` (manual correction only) and `treatment_predictions` (any insert) resets a matching `approvals.status` from `approved` back to `pending` — LLD §2.4 |

Realtime: **not implemented in this prototype** (§0.4).

### 3.4 External AI Services

| Service | Role | Notes |
|---|---|---|
| Gemini API (via Google AI Studio) | Document understanding (OCR + structured field extraction in one multimodal call), treatment explanation text | Free-tier API key; document image/PDF sent directly to Gemini's vision input — no separate OCR provider; prompted for strict JSON, schema-validated before persisting |
| sentence-transformers (`all-MiniLM-L6-v2`) | Embedding generation for similarity | Runs inside the FastAPI process — no hosted embedding API needed at prototype scale |

---

## 4. Primary Flows (Sequence-Level)

### 4.1 Flow A — Upload & Extraction
```
Patient → Frontend: fills profile form, selects file to upload
Frontend: validates file type (pdf/jpeg/png) and size (<= MAX_UPLOAD_BYTES) client-side
  if invalid → reject upload, show error, stop here
Frontend → Supabase Storage: upload file
Frontend → Supabase Postgres: insert `documents` row (status='pending', file_mime_type, file_size_bytes set)
Frontend → FastAPI: POST /extract/{document_id}  (Authorization: Bearer <user JWT>)
FastAPI: verify JWT, confirm caller owns this document's patient record or is a doctor
  if not authorized → 403, stop here
FastAPI → Supabase Postgres: update documents.extraction_status='processing'
FastAPI: re-validate file_mime_type/file_size_bytes server-side
  if invalid → 415, update extraction_status='failed', stop here
FastAPI → Supabase Storage: download file
FastAPI → Gemini API: single multimodal call — document image/PDF + extraction schema prompt
Gemini → FastAPI: JSON (fields + confidence)
FastAPI: validate JSON against schema
  if valid → delete prior extracted_fields for this document, insert fresh rows,
             update documents.extraction_status='done'
  if invalid → update documents.extraction_status='failed', flag for manual entry
FastAPI → Frontend: 200 OK
Frontend: status tracker polls and reflects pending → processing → done/failed
```
**Acceptance criteria:** re-running this flow on the same `document_id` never produces duplicate
`extracted_fields` rows; an unsupported file type never reaches the Gemini call.

### 4.2 Flow B — Prediction & Similarity
```
Doctor/Patient action or auto-trigger after extraction completes
Frontend → FastAPI: POST /predict/{patient_id}  (Authorization: Bearer <user JWT>)
FastAPI: verify JWT, confirm caller owns this patient record or is a doctor
  if not authorized → 403, stop here
FastAPI → Supabase: fetch patient profile + all extracted_fields for that patient
FastAPI: apply rule-based heuristic (LLD §7) → for each matched rule produce
  risk_band, success_band, side_effect_band, improvement_band, confidence_score
FastAPI → LLM: generate explanation text per matched rule
FastAPI → Supabase: delete existing treatment_predictions for this patient, insert fresh rows
FastAPI → Supabase: trigger auto-resets approvals.status 'approved' → 'pending' if applicable
FastAPI → Frontend: 200 OK, includes approval_reset: true/false

Frontend → FastAPI: POST /similar/{patient_id}  (Authorization: Bearer <user JWT>)
FastAPI: verify JWT, confirm caller owns this patient record or is a doctor
  if not authorized → 403, stop here
FastAPI → Supabase: fetch patient profile
FastAPI: build profile text summary → sentence-transformers → embedding vector
FastAPI → Supabase: upsert patient_embeddings
FastAPI → Supabase (pgvector): nearest-neighbor query, top-k excluding self
FastAPI → Frontend: matches (patient ids + similarity scores + their approved treatments, if any)
```
**Acceptance criteria:** re-running `/predict` on a patient whose approval was `approved` always
flips it to `pending` and the response reports `approval_reset: true`.

### 4.3 Flow C — Doctor Review & Approval
```
Doctor → Frontend: opens Doctor Queue
Frontend → Supabase: select patients where approvals.status='pending' (RLS: role='doctor')
Doctor → Frontend: opens Comparison View for a patient
Frontend → Supabase: select treatment_predictions + similarity matches for that patient
Doctor: reviews, optionally corrects extracted_fields inline
Frontend → Supabase: update extracted_fields.field_value, manually_corrected=true (if edited)
  → DB trigger: if approvals.status was 'approved', reset to 'pending'
Doctor: approves or rejects
Frontend → Supabase: update approvals.status, doctor_notes, decided_at
```

### 4.4 Flow D — Patient Views Final Plan
```
Patient → Frontend: opens Dashboard
Frontend → Supabase: select approvals + treatment_predictions where patient_id = own patient
  RLS/UI rule: only approvals.status='approved' rows render as a final plan;
  'pending' or 'rejected' always renders as "pending review" — never AI detail as final,
  including cases where approval was just reset after a post-approval edit or re-run.
```
**Acceptance criteria:** it must be impossible, by construction, for a patient to see a
`treatment_predictions` row whose corresponding `approvals.status` is not exactly `'approved'`.

---

## 5. Data Model (Overview)

Extends the blueprint schema (§5) with three additive changes only — no removals, no renames:

1. `patients.current_condition text` (nullable) — captures "current disease/defect" from the
   blueprint's patient profile fields (previously only `is_diabetic` existed).
2. `treatment_predictions.improvement_band` — the 4th prediction output the blueprint's Feature 2
   requires (previously only risk/success/side-effect existed).
3. `treatment_predictions.confidence_score` — the confidence score the blueprint's Feature 5
   dashboard requires per treatment. This is a **static value read from the rule table**, never
   computed at runtime by the LLM or by ad-hoc logic (LLD §7).

Full DDL, RLS, and trigger SQL: LLD §2.

```
auth.users (Supabase managed)
   │ 1:1
   ▼
patients ──1:N──▶ documents ──1:N──▶ extracted_fields
   │
   ├──1:N──▶ treatment_predictions
   ├──1:1──▶ patient_embeddings
   └──1:N──▶ approvals (doctor_id references auth.users)
```

---

## 6. AI/ML Design (Overview)

### 6.1 Extraction
Document image/PDF sent directly to Gemini's multimodal input → single call with a closed schema
(only named fields, `null` if absent, no free text) → validated with Pydantic before touching the
DB. No separate OCR step or provider — Gemini reads the document and extracts structured fields
in one call. Confidence is model-reported per field. Re-running extraction is idempotent (LLD
§6.1).

### 6.2 Outcome Prediction
Not ML-trained — the blueprint is explicit that there is no training data. A small, explicit rule
table (diabetes status × treatment × known interactions) produces four outputs per matched rule:
`risk_band`, `success_band`, `side_effect_band`, `improvement_band` (all low/medium/high), plus a
static `confidence_score` (0–1) attached to that rule. The LLM is only used to turn the rule
output into a plain-language explanation — **it never invents a band or a confidence value.**
This keeps the "AI-suggested estimate, not clinically validated" framing honest and auditable.

Re-running prediction is idempotent and, if the patient was already approved, forces the approval
back to `pending`.

### 6.3 Similarity
Patient profile (structured fields + short free-text summary) → sentence-transformers embedding
(384-dim, `all-MiniLM-L6-v2`) → pgvector cosine similarity. No separate vector database — pgvector
inside the same Supabase Postgres instance.

### 6.4 Explanation Generation
One shared LLM call pattern, reused for extraction confidence notes and treatment rationale
(different prompt templates — LLD §5).

---

## 7. Non-Functional Notes (Prototype-Appropriate)

| Concern | Prototype approach |
|---|---|
| Performance | No caching layer; Gemini calls (extraction + explanation) run synchronously inside `BackgroundTasks`; acceptable for single-digit concurrent users |
| Security | Supabase RLS protects direct frontend↔Supabase calls; FastAPI independently verifies the caller's JWT and role on every request; `.env` for API keys; no secrets manager |
| Reliability | If Gemini extraction fails, document status flips to `failed`; doctor can manually enter fields; re-running `/extract` or `/predict` is safe (idempotent) |
| Observability | Console/log-level logging only |
| Compliance | Explicitly NOT HIPAA/DPDP-grade — deliberate trade-off, unchanged |
| Upload hygiene | Client-side and server-side validation restrict uploads to `application/pdf`/`image/jpeg`/`image/png` and `MAX_UPLOAD_BYTES` |
| Realtime | Not implemented; polling only (§0.4) |

---

## 8. Deployment View

```
Vercel        ──▶ Next.js frontend (patient + doctor portals)
Render/Railway ──▶ FastAPI backend (3 endpoints, stateless, verifies caller JWT on each request)
Supabase (managed) ──▶ Postgres + pgvector + Storage + Auth
External APIs ──▶ Gemini API (called from backend only, key never exposed to frontend)
```
No Docker/Kubernetes required. Render/Railway build directly from the FastAPI repo.

---

## 9. Assumptions

- Single doctor role — no multi-doctor assignment/routing logic.
- Synthetic/seed patient data populates the similarity index for demo purposes.
- One report per upload; no multi-page batch upload UI.
- English-language reports only.
- Multi-treatment comparison ranking is deferred (§0.2) — the prototype may surface more than one
  matched rule/treatment from the heuristic table, but no ranking/scoring-across-treatments UI is
  built yet.

See the companion LLD for exact API contracts, SQL, prompt templates, pseudocode, and folder
structure.
