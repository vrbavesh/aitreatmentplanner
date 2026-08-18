-- supabase/seed/synthetic_patients.sql
-- LLD v2 §13 step 11 / HLD §9 — 9 synthetic patients (profile + embeddings) to populate
-- the similarity index for demo purposes. Also seeds a few approved approvals +
-- predictions so /similar can return approved_treatment.
--
-- All users share the demo password: demo-password
-- (auth.users rows are required because patients.user_id references auth.users).

-- ---------------------------------------------------------------------------
-- Auth users (one per synthetic patient)
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, aud, role, email, email_confirmed_at, encrypted_password,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'seed-patient-1@example.com', now(), extensions.crypt('demo-password', extensions.gen_salt('bf')),
  '{"provider":"email","providers":["email"],"role":"patient"}', '{}', now(), now()
union all select
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'seed-patient-2@example.com', now(), extensions.crypt('demo-password', extensions.gen_salt('bf')),
  '{"provider":"email","providers":["email"],"role":"patient"}', '{}', now(), now()
union all select
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'seed-patient-3@example.com', now(), extensions.crypt('demo-password', extensions.gen_salt('bf')),
  '{"provider":"email","providers":["email"],"role":"patient"}', '{}', now(), now()
union all select
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'seed-patient-4@example.com', now(), extensions.crypt('demo-password', extensions.gen_salt('bf')),
  '{"provider":"email","providers":["email"],"role":"patient"}', '{}', now(), now()
union all select
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'seed-patient-5@example.com', now(), extensions.crypt('demo-password', extensions.gen_salt('bf')),
  '{"provider":"email","providers":["email"],"role":"patient"}', '{}', now(), now()
union all select
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'seed-patient-6@example.com', now(), extensions.crypt('demo-password', extensions.gen_salt('bf')),
  '{"provider":"email","providers":["email"],"role":"patient"}', '{}', now(), now()
union all select
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'seed-patient-7@example.com', now(), extensions.crypt('demo-password', extensions.gen_salt('bf')),
  '{"provider":"email","providers":["email"],"role":"patient"}', '{}', now(), now()
union all select
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'seed-patient-8@example.com', now(), extensions.crypt('demo-password', extensions.gen_salt('bf')),
  '{"provider":"email","providers":["email"],"role":"patient"}', '{}', now(), now()
union all select
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'seed-patient-9@example.com', now(), extensions.crypt('demo-password', extensions.gen_salt('bf')),
  '{"provider":"email","providers":["email"],"role":"patient"}', '{}', now(), now()
on conflict (email) do nothing;

-- ---------------------------------------------------------------------------
-- Patients
-- ---------------------------------------------------------------------------
insert into patients (user_id, age, gender, is_pregnant, is_diabetic, current_condition, pulse, lifestyle_healthy, allergies)
select u.id, p.age, p.gender, p.is_pregnant, p.is_diabetic, p.current_condition, p.pulse, p.lifestyle_healthy, p.allergies
from auth.users u
join (values
  ('seed-patient-1@example.com', 58, 'male'::text,   false, true,  'type 2 diabetes',   78,  true,  '{}'::text[]),
  ('seed-patient-2@example.com', 34, 'female'::text, true,  true,  'gestational diabetes', 88,  true,  '{}'::text[]),
  ('seed-patient-3@example.com', 45, 'male'::text,   false, true,  'type 2 diabetes',   112, false, '{sulfa}'::text[]),
  ('seed-patient-4@example.com', 62, 'female'::text, false, false, 'osteoarthritis',    72,  false, '{penicillin}'::text[]),
  ('seed-patient-5@example.com', 29, 'female'::text, true,  false, null,                 82,  true,  '{}'::text[]),
  ('seed-patient-6@example.com', 51, 'male'::text,   false, true,  'type 2 diabetes',   95,  true,  '{metformin}'::text[]),
  ('seed-patient-7@example.com', 70, 'female'::text, false, false, 'hypertension',      76,  false, '{iodine}'::text[]),
  ('seed-patient-8@example.com', 38, 'male'::text,   false, false, 'asthma',            68,  true,  '{}'::text[]),
  ('seed-patient-9@example.com', 55, 'female'::text, false, true,  'type 2 diabetes',   90,  false, '{sulfa}'::text[])
) as p(email, age, gender, is_pregnant, is_diabetic, current_condition, pulse, lifestyle_healthy, allergies)
  on p.email = u.email
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Approvals + predictions for a few patients so /similar can return approved_treatment.
-- ---------------------------------------------------------------------------
insert into approvals (patient_id, status, doctor_notes, decided_at)
select p.id, 'approved', 'no complications on record', now()
from patients p join auth.users u on u.id = p.user_id
where u.email = 'seed-patient-1@example.com'
on conflict (patient_id) do nothing;

insert into approvals (patient_id, status)
select p.id, 'pending'
from patients p join auth.users u on u.id = p.user_id
where u.email in ('seed-patient-2@example.com', 'seed-patient-3@example.com', 'seed-patient-9@example.com')
on conflict (patient_id) do nothing;

insert into treatment_predictions
  (patient_id, treatment_name, risk_band, success_band, side_effect_band, improvement_band,
   confidence_score, explanation, rule_id)
select p.id, 'Metformin (first-line)', 'low', 'high', 'low', 'high', 0.85,
  'Standard first-line option; no flagged interactions with current profile.',
  'diabetes_metformin_default'
from patients p join auth.users u on u.id = p.user_id
where u.email = 'seed-patient-1@example.com';

-- ---------------------------------------------------------------------------
-- Embeddings (vector(384)) — generated with all-MiniLM-L6-v2 (LLD §8 build_profile_text).
-- Filled in at build-order step 11 using the real embedding model.
-- [[EMBEDDINGS_GENERATED_STEP_11]]
