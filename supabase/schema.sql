-- Bartool – Supabase-Schema
--
-- Im Supabase-Dashboard unter "SQL Editor" ausführen (einmalig pro Projekt).
-- Siehe supabase/README.md für die komplette Setup-Anleitung inkl. erstem
-- Admin-Konto und Deployment der Edge Function.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Rollen & Profile
-- ---------------------------------------------------------------------

create type public.user_role as enum ('admin', 'mitarbeiter');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  role public.user_role not null default 'mitarbeiter',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Security-definer-Funktion, damit die Policies auf profiles nicht in eine
-- Rekursion laufen (eine Policy auf profiles darf profiles sonst nicht
-- direkt per RLS-geschützter Query abfragen).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

create policy "profiles: read own or admin reads all"
  on public.profiles for select
  using (id = auth.uid() or public.is_admin());

-- Anlegen/Ändern/Löschen von Konten läuft über die admin-users Edge
-- Function (Service-Role) bzw. – für reine Rollenänderungen – direkt vom
-- Admin-Panel aus (per Update, ebenfalls nur für Admins erlaubt).
create policy "profiles: admin manages all"
  on public.profiles for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Hilfsfunktion: updated_at automatisch setzen
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Rezepte
-- ---------------------------------------------------------------------

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  base_portions numeric not null default 1,
  ingredients jsonb not null default '[]'::jsonb,
  method text,
  glass text,
  garnish text,
  ice text,
  history text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.recipes enable row level security;

create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

-- Jeder eingeloggte Nutzer (Admin oder Mitarbeiter) darf lesen.
create policy "recipes: any authenticated user can read"
  on public.recipes for select
  using (auth.role() = 'authenticated');

-- Nur Admins dürfen anlegen/ändern/löschen.
create policy "recipes: admin write"
  on public.recipes for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Produkte
-- ---------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  unit text,
  price numeric,
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.products enable row level security;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create policy "products: any authenticated user can read"
  on public.products for select
  using (auth.role() = 'authenticated');

create policy "products: admin write"
  on public.products for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Realtime: Änderungen live an alle eingeloggten Clients pushen
-- ---------------------------------------------------------------------

alter publication supabase_realtime add table public.recipes;
alter publication supabase_realtime add table public.products;
