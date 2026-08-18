-- 0002_enable_pgvector.sql
-- LLD v2 §2.1 — extensions. Apply this BEFORE 0001_init_tables.sql so the
-- `vector(384)` column in `patient_embeddings` resolves at DDL time.
create extension if not exists vector;
create extension if not exists pgcrypto; -- for gen_random_uuid()
