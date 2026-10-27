-- Guest ID documents (Aadhaar, passport, etc.) uploaded at check-in or from the guest profile.
-- Run in the Supabase SQL editor after front-office-schema.sql and multi-property-schema.sql.
--
-- Files are stored as base64 data URLs (max 5 MB per file, enforced in the app),
-- in their own table so guest lists never load document payloads.

create table if not exists public.guest_documents (
  id text primary key,
  property_id text references public.properties(id) on delete cascade,
  guest_id text not null references public.guests(id) on delete cascade,
  reservation_id text references public.reservations(id) on delete set null,
  document_type text,
  file_name text not null,
  mime_type text,
  file_size integer,
  data_url text not null,
  uploaded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_guest_documents_guest
  on public.guest_documents (guest_id, created_at desc);

create index if not exists idx_guest_documents_reservation
  on public.guest_documents (reservation_id);

alter table public.guest_documents enable row level security;

drop policy if exists "anon_all_guest_documents" on public.guest_documents;
create policy "anon_all_guest_documents" on public.guest_documents
  for all to anon using (true) with check (true);
