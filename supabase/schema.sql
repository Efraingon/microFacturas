-- MicroFacturas: comprobantes por usuario y fotos privadas.
-- Ejecutar en Supabase > SQL Editor > New query.

create table if not exists public.receipts (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  receipt_number text not null default '',
  location text not null default '',
  amount numeric(16, 2) not null check (amount >= 0),
  bank text not null default '',
  image_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists receipts_user_date_idx
  on public.receipts (user_id, date desc, created_at desc);

alter table public.receipts enable row level security;

drop policy if exists "Users can read their receipts" on public.receipts;
create policy "Users can read their receipts"
  on public.receipts for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can add their receipts" on public.receipts;
create policy "Users can add their receipts"
  on public.receipts for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their receipts" on public.receipts;
create policy "Users can delete their receipts"
  on public.receipts for delete to authenticated
  using (auth.uid() = user_id);

-- Bucket privado de Storage (10 MB por imagen, solo formatos de imagen comunes).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprobantes',
  'comprobantes',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their receipt images" on storage.objects;
create policy "Users can read their receipt images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'comprobantes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can upload their receipt images" on storage.objects;
create policy "Users can upload their receipt images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'comprobantes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users can delete their receipt images" on storage.objects;
create policy "Users can delete their receipt images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'comprobantes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
