-- 0004_approval_reset_trigger.sql
-- LLD v2 §2.4 — approval reset trigger.
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

-- ---------------------------------------------------------------------------
-- match_similar_patients — LLD v2 §8 "Supporting Postgres function (add to a migration)".
-- Runs a pgvector cosine nearest-neighbour query excluding the query patient.
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

-- ---------------------------------------------------------------------------
-- Role claim for self-service patient signups.
-- TODO(spec-gap): LLD §2.2 says `role` is set in app_metadata via the Admin API and that
-- doctors are provisioned manually, but HLD §3.1 includes a patient signup page. A client-side
-- signUp() cannot set app_metadata, so without this trigger a self-signed-up patient has no
-- `role` claim and every RLS policy (which keys off `app_metadata.role`) rejects them.
-- Admin-provisioned users (seed doctor/patients) already carry an explicit role and are
-- untouched by this trigger.
create or replace function set_patient_role_on_signup()
returns trigger
language plpgsql
security definer
as $$
begin
  if (new.raw_app_meta_data ->> 'role') is null then
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb) || '{"role":"patient"}'::jsonb;
  end if;
  return new;
end;
$$;

create trigger trg_set_patient_role_on_signup
  before insert on auth.users
  for each row
  execute function set_patient_role_on_signup();
