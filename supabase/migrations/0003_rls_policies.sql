-- 0003_rls_policies.sql
-- LLD v2 §2.3 — row level security policies.
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

-- ---------------------------------------------------------------------------
-- Storage (bucket "reports") — required for the frontend upload path.
-- TODO(spec-gap): LLD §2.3 defines only table-level RLS. The frontend uploads the raw
-- file directly to Supabase Storage with the publishable (RLS-scoped) key, which needs
-- storage.objects policies or every upload fails. The bucket name "reports" is named in
-- LLD §6.1/§12. Uploads are stored under `<auth.uid()>/<uuid>` so patients can only read
-- their own folder; doctors can read everything.
insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;

create policy "reports_insert_authenticated" on storage.objects for insert to authenticated
  with check (bucket_id = 'reports');
create policy "reports_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "reports_select_doctor" on storage.objects for select to authenticated
  using (bucket_id = 'reports' and (auth.jwt() -> 'app_metadata' ->> 'role') = 'doctor');

-- ---------------------------------------------------------------------------
-- Table/sequence/function privileges.
-- TODO(spec-gap): LLD §2 does not include GRANT statements; the Supabase dashboard
-- normally applies these default grants automatically for tables created through it.
-- Migrations applied here via a direct connection must grant them explicitly, otherwise
-- `anon`/`authenticated`/`service_role` get "permission denied for table ..." (42501).
-- GRANT is idempotent, so this section is safe to re-run.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
