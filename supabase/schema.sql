-- Bartool – Supabase-Schema
--
-- Im Supabase-Dashboard unter "SQL Editor" ausführen. Das Skript ist
-- gefahrlos mehrfach ausführbar (z. B. nach einem Abbruch mittendrin) –
-- bestehende Tabellen/Daten werden dabei nicht angetastet, nur fehlende
-- Objekte werden ergänzt bzw. Policies/Trigger neu gesetzt.
-- Siehe supabase/README.md für die komplette Setup-Anleitung inkl. erstem
-- Admin-Konto und Deployment der Edge Function.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Rollen & Profile
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'user_role' and typnamespace = 'public'::regnamespace
  ) then
    create type public.user_role as enum ('admin', 'mitarbeiter');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  role public.user_role not null default 'mitarbeiter',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- is_admin() lebt bewusst in einem eigenen, nicht von PostgREST exponierten
-- Schema statt in "public": Funktionen in "public" werden automatisch als
-- /rest/v1/rpc/<name>-Endpunkt exposed, auch SECURITY DEFINER-Funktionen.
-- In "private" bleibt sie trotzdem ganz normal in RLS-Policies nutzbar
-- (Postgres wertet Policies serverseitig aus, unabhängig vom PostgREST-
-- Schema-Exposure), ist aber nicht mehr direkt von außen aufrufbar.
create schema if not exists private;

-- Alte Version aus "public" entfernen, falls aus einem früheren Setup noch
-- vorhanden (cascade räumt die alten, darauf verweisenden Policies mit weg –
-- die werden weiter unten ohnehin neu angelegt).
drop function if exists public.is_admin() cascade;

create or replace function private.is_admin()
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

grant usage on schema private to authenticated;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated;

drop policy if exists "profiles: read own or admin reads all" on public.profiles;
create policy "profiles: read own or admin reads all"
  on public.profiles for select
  using (id = auth.uid() or private.is_admin());

-- Anlegen/Ändern/Löschen von Konten läuft über die admin-users Edge
-- Function (Service-Role) bzw. – für reine Rollenänderungen – direkt vom
-- Admin-Panel aus (per Update, ebenfalls nur für Admins erlaubt).
drop policy if exists "profiles: admin manages all" on public.profiles;
create policy "profiles: admin manages all"
  on public.profiles for all
  using (private.is_admin())
  with check (private.is_admin());

-- ---------------------------------------------------------------------
-- Benutzername-Login & erzwungener Passwortwechsel
-- ---------------------------------------------------------------------
-- Login läuft über einen Benutzernamen statt der E-Mail (siehe Edge
-- Function "login-with-username") – einfacher zu merken/eintippen hinterm
-- Tresen. Die E-Mail bleibt intern für Supabase Auth bestehen.

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists must_change_password boolean not null default true;

-- Bestehende Profile ohne Benutzernamen: aus dem E-Mail-Lokalteil ableiten,
-- greift nur beim allerersten Lauf nach diesem Update.
update public.profiles
set username = regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9._-]', '', 'g')
where username is null;

alter table public.profiles alter column username set not null;

alter table public.profiles drop constraint if exists profiles_username_key;
alter table public.profiles add constraint profiles_username_key unique (username);

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username ~ '^[a-z0-9._-]{3,32}$');

-- Eng begrenzter RPC-Aufruf: setzt must_change_password ausschließlich für
-- das eigene Konto zurück, kein generelles Self-Update auf profiles nötig.
create or replace function public.mark_password_changed()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;

revoke all on function public.mark_password_changed() from public;
revoke execute on function public.mark_password_changed() from anon;
grant execute on function public.mark_password_changed() to authenticated;

-- Beim erzwungenen Erst-Login darf sich der Nutzer zusätzlich zum neuen
-- Passwort auch einen eigenen Benutzernamen aussuchen (statt des vom Admin
-- vergebenen Platzhalters). Format-/Unique-Constraints auf profiles.username
-- greifen dabei ganz normal weiter.
create or replace function public.complete_first_login(new_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set username = lower(trim(new_username)), must_change_password = false
  where id = auth.uid();
end;
$$;

revoke all on function public.complete_first_login(text) from public;
revoke execute on function public.complete_first_login(text) from anon;
grant execute on function public.complete_first_login(text) to authenticated;

-- ---------------------------------------------------------------------
-- Hilfsfunktion: updated_at automatisch setzen
-- ---------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Rezepte
-- ---------------------------------------------------------------------

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  base_portions numeric not null default 1,
  ingredients jsonb not null default '[]'::jsonb,
  method text,
  glass text,
  garnish text,
  ice text,
  history text,
  quick_pitch text,
  pairs_with jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.recipes add column if not exists quick_pitch text;
alter table public.recipes add column if not exists pairs_with jsonb;

alter table public.recipes enable row level security;

drop trigger if exists recipes_set_updated_at on public.recipes;
create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

-- Jeder eingeloggte Nutzer (Admin oder Mitarbeiter) darf lesen.
drop policy if exists "recipes: any authenticated user can read" on public.recipes;
create policy "recipes: any authenticated user can read"
  on public.recipes for select
  using (auth.role() = 'authenticated');

-- Nur Admins dürfen anlegen/ändern/löschen.
drop policy if exists "recipes: admin write" on public.recipes;
create policy "recipes: admin write"
  on public.recipes for all
  using (private.is_admin())
  with check (private.is_admin());

-- ---------------------------------------------------------------------
-- Produkte
-- ---------------------------------------------------------------------

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  -- "unit", "price" und "note" stammen aus der ursprünglichen, einfachen
  -- Produktverwaltung und werden vom Produktwissen-Katalog unten nicht mehr
  -- befüllt. Sie bleiben unangetastet stehen, damit bereits gespeicherte
  -- Daten nicht verloren gehen.
  unit text,
  price numeric,
  note text,
  group_name text,
  sub_group text,
  abv text,
  tasting_notes text,
  service text,
  alternatives text,
  story text,
  production text,
  allergens text,
  price_value numeric,
  price_unit text,
  quick_pitch text,
  pairs_with jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.products add column if not exists group_name text;
alter table public.products add column if not exists sub_group text;
alter table public.products add column if not exists abv text;
alter table public.products add column if not exists tasting_notes text;
alter table public.products add column if not exists service text;
alter table public.products add column if not exists alternatives text;
alter table public.products add column if not exists story text;
alter table public.products add column if not exists production text;
alter table public.products add column if not exists allergens text;
alter table public.products add column if not exists price_value numeric;
alter table public.products add column if not exists price_unit text;
alter table public.products add column if not exists quick_pitch text;
alter table public.products add column if not exists pairs_with jsonb;

alter table public.products enable row level security;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

drop policy if exists "products: any authenticated user can read" on public.products;
create policy "products: any authenticated user can read"
  on public.products for select
  using (auth.role() = 'authenticated');

drop policy if exists "products: admin write" on public.products;
create policy "products: admin write"
  on public.products for all
  using (private.is_admin())
  with check (private.is_admin());

-- ---------------------------------------------------------------------
-- Realtime: Änderungen live an alle eingeloggten Clients pushen
-- ---------------------------------------------------------------------

do $$
begin
  alter publication supabase_realtime add table public.recipes;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.products;
exception
  when duplicate_object then null;
end $$;
