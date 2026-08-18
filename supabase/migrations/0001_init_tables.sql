-- 0001_init_tables.sql
-- LLD v2 §2.1 — table DDL.
-- NOTE (build-order dependency): `patient_embeddings.embedding vector(384)` requires the
-- `vector` extension, which is enabled in 0002_enable_pgvector.sql. Apply 0002 BEFORE 0001.
-- TODO(spec-gap): LLD §13 lists 0001 before 0002, but 0001 uses the vector type; applying in
-- that literal order fails on a fresh project. Resolved by applying 0002 first.
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
