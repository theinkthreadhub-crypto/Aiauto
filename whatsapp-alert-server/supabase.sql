-- Supabase → SQL Editor → New query → ye paste karo → Run
create table if not exists public.wa_auth (
  id text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- Security: public (anon) key se koi access nahi. Server secret key use karta hai.
alter table public.wa_auth enable row level security;
