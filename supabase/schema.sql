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
  category text,
  base_portions numeric not null default 1,
  ingredients jsonb not null default '[]'::jsonb,
  method text,
  glass text,
  garnish text,
  ice text,
  history text,
  quick_pitch text,
  pairs_with jsonb,
  -- Verkaufspreis brutto in Euro, Grundlage der Kartenkalkulation.
  sales_price numeric,
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.recipes add column if not exists quick_pitch text;
alter table public.recipes add column if not exists pairs_with jsonb;
alter table public.recipes add column if not exists category text;
alter table public.recipes add column if not exists sales_price numeric;

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
  -- Nur für Wein/Schaumwein befüllt (siehe Produkte-Tab, Kategorie "Wein").
  region text,
  grape_variety text,
  vineyard text,
  vintage text,
  aging text,
  -- Bewusst allgemein gehalten (keine konkreten Gerichte), z. B. "passt zu
  -- hellem Fleisch, Fisch, milden Käsesorten".
  food_pairing text,
  -- Nur für Jahrgangs-Champagner/Prestige-Cuvées relevant.
  drinking_window text,
  -- Produktwissen (Paket 21): strukturierte, abfragbare Felder als Grundlage
  -- für Textausbau und Quiz. "abv" bleibt der Anzeigetext, hier steht die Zahl;
  -- bei Bereichsangaben ("40–43 % vol") ist abv_value die Unter- und abv_max
  -- die Obergrenze.
  abv_value numeric,
  abv_max numeric,
  -- Herkunft, bisher nur im Freitext "category" hinter dem Mittelpunkt.
  origin_country text,
  origin_region text,
  base_material text,
  production_method text,
  age_statement text,
  -- Liste kurzer Aromabegriffe, z. B. ["Wacholder", "Zitrus", "Koriander"].
  flavor_tags jsonb,
  -- Nur für Wein/Schaumwein befüllt (siehe Produkte-Tab, Kategorie "Wein").
  producer text,
  sweetness text,
  classification text,
  serving_temp text,
  body text,
  -- Redaktionsstand: nur geprüfte Produkte werden im Quiz abgefragt.
  -- Maschinell Abgeleitetes bleibt bewusst auf false.
  verified boolean not null default false,
  verified_at timestamptz,
  -- Bestellwesen: Soll-Bestand, Lieferant und Bestelleinheit.
  par_level numeric,
  supplier text,
  order_unit text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.products add column if not exists par_level numeric;
alter table public.products add column if not exists supplier text;
alter table public.products add column if not exists order_unit text;
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
alter table public.products add column if not exists region text;
alter table public.products add column if not exists grape_variety text;
alter table public.products add column if not exists vineyard text;
alter table public.products add column if not exists vintage text;
alter table public.products add column if not exists aging text;
alter table public.products add column if not exists food_pairing text;
alter table public.products add column if not exists drinking_window text;
alter table public.products add column if not exists abv_value numeric;
alter table public.products add column if not exists abv_max numeric;
alter table public.products add column if not exists origin_country text;
alter table public.products add column if not exists origin_region text;
alter table public.products add column if not exists base_material text;
alter table public.products add column if not exists production_method text;
alter table public.products add column if not exists age_statement text;
alter table public.products add column if not exists flavor_tags jsonb;
alter table public.products add column if not exists producer text;
alter table public.products add column if not exists sweetness text;
alter table public.products add column if not exists classification text;
alter table public.products add column if not exists serving_temp text;
alter table public.products add column if not exists body text;
alter table public.products add column if not exists verified boolean not null default false;
alter table public.products add column if not exists verified_at timestamptz;

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
-- Audit-Log: Änderungshistorie für recipes/products/profiles
-- ---------------------------------------------------------------------
-- Ansätze / Mise en Place
-- ---------------------------------------------------------------------

create table if not exists public.preparations (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  recipe_name text,
  -- superjuice | sirup | batch | batch_juice | sonstiges
  prep_type text not null default 'sonstiges',
  batch_size_ml numeric,
  abv numeric,
  location text,
  made_at timestamptz not null default now(),
  made_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz,
  -- aktiv | verbraucht
  status text not null default 'aktiv',
  notes text,
  updated_at timestamptz not null default now()
);

create index if not exists preparations_expires_at_idx on public.preparations (expires_at);

alter table public.preparations enable row level security;

drop trigger if exists preparations_set_updated_at on public.preparations;
create trigger preparations_set_updated_at
  before update on public.preparations
  for each row execute function public.set_updated_at();

-- Ansätze macht das ganze Team, nicht nur Admins: lesen, anlegen und
-- ändern darf jeder eingeloggte Nutzer. Löschen bleibt Admin-Sache,
-- damit nichts unbemerkt aus der Übersicht verschwindet.
drop policy if exists "preparations: any authenticated user can read" on public.preparations;
create policy "preparations: any authenticated user can read"
  on public.preparations for select
  using (auth.role() = 'authenticated');

drop policy if exists "preparations: any authenticated user can insert" on public.preparations;
create policy "preparations: any authenticated user can insert"
  on public.preparations for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "preparations: any authenticated user can update" on public.preparations;
create policy "preparations: any authenticated user can update"
  on public.preparations for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "preparations: admin deletes" on public.preparations;
create policy "preparations: admin deletes"
  on public.preparations for delete
  using (private.is_admin());

-- ---------------------------------------------------------------------
-- Event-/Bankett-Planer
-- ---------------------------------------------------------------------

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  event_date date,
  guests numeric,
  duration_hours numeric,
  drinks_per_guest numeric,
  buffer_percent numeric not null default 10,
  -- [{ recipeName: "...", share: 40 }] – Anteile in Prozent, Summe soll 100 sein
  drink_mix jsonb not null default '[]'::jsonb,
  ice_kg_per_drink numeric,
  notes text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists events_event_date_idx on public.events (event_date);

alter table public.events enable row level security;

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

-- Gleiches Muster wie bei den Ansätzen: Events plant das ganze Team.
-- Lesen, anlegen und ändern darf jeder eingeloggte Nutzer, löschen bleibt
-- Admin-Sache, damit keine Planung unbemerkt verschwindet.
drop policy if exists "events: any authenticated user can read" on public.events;
create policy "events: any authenticated user can read"
  on public.events for select
  using (auth.role() = 'authenticated');

drop policy if exists "events: any authenticated user can insert" on public.events;
create policy "events: any authenticated user can insert"
  on public.events for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "events: any authenticated user can update" on public.events;
create policy "events: any authenticated user can update"
  on public.events for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "events: admin deletes" on public.events;
create policy "events: admin deletes"
  on public.events for delete
  using (private.is_admin());

-- ---------------------------------------------------------------------
-- Schichtübergabe / Barbuch
-- ---------------------------------------------------------------------

create table if not exists public.shift_logs (
  id uuid primary key default gen_random_uuid(),
  shift_date date not null default current_date,
  -- frueh | spaet | nacht
  shift text not null default 'spaet',
  summary text,
  -- [{ text: "...", done: false, doneBy: null, doneAt: null }]
  open_items jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shift_logs_date_idx on public.shift_logs (shift_date desc);

alter table public.shift_logs enable row level security;

drop trigger if exists shift_logs_set_updated_at on public.shift_logs;
create trigger shift_logs_set_updated_at
  before update on public.shift_logs
  for each row execute function public.set_updated_at();

-- Wie bei den Ansätzen: die Übergabe schreibt das ganze Team. Lesen,
-- anlegen und ändern (Punkte abhaken) darf jeder eingeloggte Nutzer,
-- löschen bleibt Admin-Sache, damit nichts unbemerkt verschwindet.
drop policy if exists "shift_logs: any authenticated user can read" on public.shift_logs;
create policy "shift_logs: any authenticated user can read"
  on public.shift_logs for select
  using (auth.role() = 'authenticated');

drop policy if exists "shift_logs: any authenticated user can insert" on public.shift_logs;
create policy "shift_logs: any authenticated user can insert"
  on public.shift_logs for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "shift_logs: any authenticated user can update" on public.shift_logs;
create policy "shift_logs: any authenticated user can update"
  on public.shift_logs for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "shift_logs: admin deletes" on public.shift_logs;
create policy "shift_logs: admin deletes"
  on public.shift_logs for delete
  using (private.is_admin());

-- ---------------------------------------------------------------------
-- Checklisten Opening/Closing + Nachweisdokumentation
-- ---------------------------------------------------------------------

create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- opening | closing | reinigung | temperatur | sonstiges
  kind text not null default 'sonstiges',
  -- [{ id, label, type: "check" | "wert", unit: "°C", hint: "", min, max }]
  items jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.checklist_templates enable row level security;

drop trigger if exists checklist_templates_set_updated_at on public.checklist_templates;
create trigger checklist_templates_set_updated_at
  before update on public.checklist_templates
  for each row execute function public.set_updated_at();

-- Vorlagen sind die Regel, nach der gearbeitet wird: lesen alle, pflegen
-- nur Admins (Muster recipes/products).
drop policy if exists "checklist_templates: any authenticated user can read" on public.checklist_templates;
create policy "checklist_templates: any authenticated user can read"
  on public.checklist_templates for select
  using (auth.role() = 'authenticated');

drop policy if exists "checklist_templates: admin write" on public.checklist_templates;
create policy "checklist_templates: admin write"
  on public.checklist_templates for all
  using (private.is_admin())
  with check (private.is_admin());

create table if not exists public.checklist_runs (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.checklist_templates (id) on delete cascade,
  run_date date not null default current_date,
  -- [{ itemId, done, value, note, by, at }]
  entries jsonb not null default '[]'::jsonb,
  finished_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Pro Vorlage und Tag genau ein Lauf: sonst führen zwei Geräte, die
-- gleichzeitig "Lauf öffnen" drücken, zwei getrennte Nachweise.
create unique index if not exists checklist_runs_template_date_idx
  on public.checklist_runs (template_id, run_date);

create index if not exists checklist_runs_date_idx on public.checklist_runs (run_date desc);

alter table public.checklist_runs enable row level security;

drop trigger if exists checklist_runs_set_updated_at on public.checklist_runs;
create trigger checklist_runs_set_updated_at
  before update on public.checklist_runs
  for each row execute function public.set_updated_at();

-- Abgehakt wird von der ganzen Schicht: lesen, anlegen und ändern darf
-- jeder eingeloggte Nutzer, löschen bleibt Admin-Sache, damit kein
-- Nachweis unbemerkt verschwindet (Muster preparations/shift_logs).
drop policy if exists "checklist_runs: any authenticated user can read" on public.checklist_runs;
create policy "checklist_runs: any authenticated user can read"
  on public.checklist_runs for select
  using (auth.role() = 'authenticated');

drop policy if exists "checklist_runs: any authenticated user can insert" on public.checklist_runs;
create policy "checklist_runs: any authenticated user can insert"
  on public.checklist_runs for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "checklist_runs: any authenticated user can update" on public.checklist_runs;
create policy "checklist_runs: any authenticated user can update"
  on public.checklist_runs for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists "checklist_runs: admin deletes" on public.checklist_runs;
create policy "checklist_runs: admin deletes"
  on public.checklist_runs for delete
  using (private.is_admin());

-- ---------------------------------------------------------------------
-- Einkaufspreis-Historie
--
-- Jede Änderung des Einkaufspreises eines Produkts wird als eigene Zeile
-- festgehalten, statt den alten Wert zu überschreiben. Geschrieben wird
-- ausschließlich aus saveProduct() (js/storage.js) heraus.
-- ---------------------------------------------------------------------

create table if not exists public.product_prices (
  id uuid primary key default gen_random_uuid(),
  product_name text not null,
  price_value numeric,
  price_unit text,
  valid_from date not null default current_date,
  source text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists product_prices_name_idx
  on public.product_prices (product_name, valid_from desc);

alter table public.product_prices enable row level security;

-- Preisstände sind Arbeitsgrundlage für die Kalkulation: lesen darf jeder
-- eingeloggte Nutzer, schreiben nur Admins (Muster products).
drop policy if exists "product_prices: any authenticated user can read" on public.product_prices;
create policy "product_prices: any authenticated user can read"
  on public.product_prices for select
  using (auth.role() = 'authenticated');

drop policy if exists "product_prices: admin write" on public.product_prices;
create policy "product_prices: admin write"
  on public.product_prices for all
  using (private.is_admin())
  with check (private.is_admin());

-- Startpunkt: der Ist-Stand aller gepflegten Einkaufspreise als erste Zeile.
insert into public.product_prices (product_name, price_value, price_unit, valid_from, source)
select p.name, p.price_value, p.price_unit, current_date, 'Bestand bei Einführung'
from public.products p
where p.price_value is not null
  and not exists (select 1 from public.product_prices pp where pp.product_name = p.name);

-- ---------------------------------------------------------------------
-- Inventur
-- ---------------------------------------------------------------------

create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  counted_on date not null default current_date,
  title text,
  -- offen | abgeschlossen
  status text not null default 'offen',
  created_by uuid references public.profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bewusst product_name statt product_id: das ganze Tool arbeitet
-- namensbasiert (siehe Zutaten-Matching), und eine Zählung soll auch dann
-- lesbar bleiben, wenn ein Produkt später umbenannt oder gelöscht wird.
create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.inventory_counts (id) on delete cascade,
  product_name text not null,
  -- null bedeutet "noch nicht gezählt" und ist etwas anderes als 0
  -- ("gezählt, nichts da"). Diese Unterscheidung muss erhalten bleiben.
  quantity numeric,
  unit text,
  updated_at timestamptz not null default now(),
  unique (count_id, product_name)
);

create index if not exists inventory_items_count_id_idx on public.inventory_items (count_id);

alter table public.inventory_counts enable row level security;
alter table public.inventory_items enable row level security;

drop trigger if exists inventory_counts_set_updated_at on public.inventory_counts;
create trigger inventory_counts_set_updated_at
  before update on public.inventory_counts
  for each row execute function public.set_updated_at();

drop trigger if exists inventory_items_set_updated_at on public.inventory_items;
create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

-- Gezählt wird im Team: lesen, anlegen und ändern für alle Angemeldeten,
-- löschen nur Admin.
drop policy if exists "inventory_counts: read" on public.inventory_counts;
create policy "inventory_counts: read" on public.inventory_counts for select
  using (auth.role() = 'authenticated');

drop policy if exists "inventory_counts: insert" on public.inventory_counts;
create policy "inventory_counts: insert" on public.inventory_counts for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "inventory_counts: update" on public.inventory_counts;
create policy "inventory_counts: update" on public.inventory_counts for update
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "inventory_counts: admin deletes" on public.inventory_counts;
create policy "inventory_counts: admin deletes" on public.inventory_counts for delete
  using (private.is_admin());

drop policy if exists "inventory_items: read" on public.inventory_items;
create policy "inventory_items: read" on public.inventory_items for select
  using (auth.role() = 'authenticated');

drop policy if exists "inventory_items: insert" on public.inventory_items;
create policy "inventory_items: insert" on public.inventory_items for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "inventory_items: update" on public.inventory_items;
create policy "inventory_items: update" on public.inventory_items for update
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "inventory_items: admin deletes" on public.inventory_items;
create policy "inventory_items: admin deletes" on public.inventory_items for delete
  using (private.is_admin());

-- ---------------------------------------------------------------------

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  row_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb
);

alter table public.audit_log enable row level security;

drop policy if exists "audit_log: admin reads all" on public.audit_log;
create policy "audit_log: admin reads all"
  on public.audit_log for select
  using (private.is_admin());

-- Bewusst keine Insert/Update/Delete-Policy für authenticated/anon – nur
-- die SECURITY DEFINER-Trigger-Funktion unten schreibt hier hinein, sie
-- läuft als Tabellenbesitzer und umgeht RLS wie gewohnt.
create or replace function public.log_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (table_name, row_id, action, changed_by, old_data, new_data)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    lower(tg_op),
    auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.log_audit() from public;

drop trigger if exists recipes_audit on public.recipes;
create trigger recipes_audit
  after insert or update or delete on public.recipes
  for each row execute function public.log_audit();

drop trigger if exists products_audit on public.products;
create trigger products_audit
  after insert or update or delete on public.products
  for each row execute function public.log_audit();

drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function public.log_audit();

-- ---------------------------------------------------------------------
-- Freigabe-Workflow: Mitarbeiter schlagen Änderungen vor, Admin prüft
-- ---------------------------------------------------------------------

create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  table_name text not null check (table_name in ('recipes', 'products')),
  row_id uuid,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  proposed_by uuid not null references public.profiles (id) on delete cascade,
  reviewed_by uuid references public.profiles (id) on delete set null,
  review_comment text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

-- "upsert" (Anlegen/Ändern) oder "delete" (Löschung, payload = { name }).
alter table public.change_requests add column if not exists action text not null default 'upsert';
alter table public.change_requests drop constraint if exists change_requests_action_check;
alter table public.change_requests add constraint change_requests_action_check check (action in ('upsert', 'delete'));

alter table public.change_requests enable row level security;

drop policy if exists "change_requests: own insert" on public.change_requests;
create policy "change_requests: own insert"
  on public.change_requests for insert
  with check (proposed_by = auth.uid());

drop policy if exists "change_requests: own or admin select" on public.change_requests;
create policy "change_requests: own or admin select"
  on public.change_requests for select
  using (proposed_by = auth.uid() or private.is_admin());

drop policy if exists "change_requests: admin update" on public.change_requests;
create policy "change_requests: admin update"
  on public.change_requests for update
  using (private.is_admin())
  with check (private.is_admin());

do $$
begin
  alter publication supabase_realtime add table public.change_requests;
exception
  when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------
-- Quiz (Paket 26)
--
-- quiz_questions = kuratierte Fragen. Der Generator im Frontend
-- (js/quizGenerator.js) baut seine Fragen direkt aus products/recipes und
-- braucht keine Tabelle; hier steht nur, was in keinem Produktfeld steht:
-- Servicewissen, Hausregeln, Trainee-Prüfungsstoff.
-- ---------------------------------------------------------------------

create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  -- ["Antwort A", "Antwort B", ...] – mindestens 2 Einträge
  options jsonb not null default '[]'::jsonb,
  correct_index int not null default 0,
  explanation text not null default '',
  topic text not null default 'Servicewissen',
  -- 1 = leicht, 2 = mittel, 3 = schwer
  difficulty int not null default 2,
  -- optionaler Sprung in die Bibliothek nach einer falschen Antwort
  ref_product text,
  ref_recipe text,
  active boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.quiz_questions drop constraint if exists quiz_questions_correct_index_check;
alter table public.quiz_questions add constraint quiz_questions_correct_index_check check (correct_index >= 0);

alter table public.quiz_questions drop constraint if exists quiz_questions_difficulty_check;
alter table public.quiz_questions add constraint quiz_questions_difficulty_check check (difficulty between 1 and 3);

alter table public.quiz_questions enable row level security;

drop trigger if exists quiz_questions_set_updated_at on public.quiz_questions;
create trigger quiz_questions_set_updated_at
  before update on public.quiz_questions
  for each row execute function public.set_updated_at();

-- Fragen sind Lernstoff für alle, gepflegt werden sie von der Barleitung.
drop policy if exists "quiz_questions: any authenticated user can read" on public.quiz_questions;
create policy "quiz_questions: any authenticated user can read"
  on public.quiz_questions for select
  using (auth.role() = 'authenticated');

drop policy if exists "quiz_questions: admin write" on public.quiz_questions;
create policy "quiz_questions: admin write"
  on public.quiz_questions for all
  using (private.is_admin())
  with check (private.is_admin());

-- quiz_attempts = eine Zeile pro beantworteter Frage. Grundlage für die
-- Auswertung in Paket 27; question_key ist über Sessions hinweg stabil
-- ("gen:abv:<Produktname>" für generierte, "db:<uuid>" für kuratierte).
create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  question_key text not null,
  topic text not null default '',
  correct boolean not null,
  answered_at timestamptz not null default now(),
  -- Klammert die Versuche einer Runde zusammen (Paket 27). Ohne die Spalte
  -- liesse sich weder "Anzahl Runden" noch der Rundenverlauf bilden.
  round_id uuid
);

alter table public.quiz_attempts add column if not exists round_id uuid;

create index if not exists quiz_attempts_user_answered_idx
  on public.quiz_attempts (user_id, answered_at desc);
create index if not exists quiz_attempts_question_key_idx
  on public.quiz_attempts (question_key);
create index if not exists quiz_attempts_user_round_idx
  on public.quiz_attempts (user_id, round_id);

alter table public.quiz_attempts enable row level security;

-- Jeder sieht ausschliesslich die eigenen Versuche - auch Admins. Die
-- Barleitung bekommt nur Aggregate, ueber die beiden Funktionen weiter unten
-- (Paket 27). Einzelne Antworten einer Person sind bewusst nicht einsehbar.
drop policy if exists "quiz_attempts: own or admin select" on public.quiz_attempts;
drop policy if exists "quiz_attempts: own select" on public.quiz_attempts;
create policy "quiz_attempts: own select"
  on public.quiz_attempts for select
  using (user_id = auth.uid());

drop policy if exists "quiz_attempts: own insert" on public.quiz_attempts;
create policy "quiz_attempts: own insert"
  on public.quiz_attempts for insert
  with check (user_id = auth.uid());

drop policy if exists "quiz_attempts: admin deletes" on public.quiz_attempts;
create policy "quiz_attempts: admin deletes"
  on public.quiz_attempts for delete
  using (private.is_admin());

-- ---------------------------------------------------------------------
-- Quiz-Auswertung fuer die Barleitung (Paket 27)
--
-- Beide Funktionen laufen als security definer und pruefen selbst auf Admin.
-- Sie geben ausschliesslich Summen zurueck, nie einzelne Antworten - das ist
-- der Grund, warum die select-Policy oben Admins nicht mehr einschliesst.
-- ---------------------------------------------------------------------

create or replace function public.quiz_team_overview()
returns table (
  user_id uuid,
  display_name text,
  email text,
  rounds bigint,
  attempts bigint,
  correct bigint,
  accuracy numeric,
  last_answered_at timestamptz,
  weakest_topics jsonb
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not private.is_admin() then
    raise exception 'Nur die Barleitung darf die Team-Auswertung lesen.'
      using errcode = '42501';
  end if;

  return query
  with basis as (
    select
      a.user_id as uid,
      a.topic as topic,
      a.correct as correct,
      a.answered_at as answered_at,
      -- Altzeilen ohne round_id: die angebrochene Stunde als Ersatzschluessel.
      coalesce(a.round_id::text, 'h:' || date_trunc('hour', a.answered_at)::text) as rundenschluessel
    from public.quiz_attempts a
  ),
  je_person as (
    select
      b.uid,
      count(distinct b.rundenschluessel) as rounds,
      count(*) as attempts,
      count(*) filter (where b.correct) as correct,
      max(b.answered_at) as last_answered_at
    from basis b
    group by b.uid
  ),
  je_thema as (
    select
      b.uid,
      b.topic as topic,
      count(*) as attempts,
      count(*) filter (where b.correct) as correct
    from basis b
    where b.topic <> ''
    group by b.uid, b.topic
    -- Unter drei Versuchen ist eine Quote pro Thema reines Rauschen.
    having count(*) >= 3
  ),
  gereiht as (
    select
      t.uid,
      t.topic,
      t.attempts,
      round(100.0 * t.correct / t.attempts) as accuracy,
      row_number() over (
        partition by t.uid
        order by (1.0 * t.correct / t.attempts) asc, t.attempts desc, t.topic asc
      ) as platz
    from je_thema t
  ),
  schwach as (
    select
      g.uid,
      jsonb_agg(
        jsonb_build_object('topic', g.topic, 'attempts', g.attempts, 'accuracy', g.accuracy)
        order by g.platz
      ) as weakest_topics
    from gereiht g
    where g.platz <= 3
    group by g.uid
  )
  select
    p.id,
    p.display_name,
    p.email,
    coalesce(jp.rounds, 0),
    coalesce(jp.attempts, 0),
    coalesce(jp.correct, 0),
    case when coalesce(jp.attempts, 0) = 0 then null
         else round(100.0 * jp.correct / jp.attempts) end,
    jp.last_answered_at,
    coalesce(s.weakest_topics, '[]'::jsonb)
  from public.profiles p
  left join je_person jp on jp.uid = p.id
  left join schwach s on s.uid = p.id
  order by coalesce(jp.attempts, 0) desc, p.display_name asc nulls last, p.email asc;
end;
$$;

revoke all on function public.quiz_team_overview() from public;
grant execute on function public.quiz_team_overview() to authenticated;

-- Themen-Heatmap ueber das ganze Team: wo hakt es bei allen?
create or replace function public.quiz_topic_heatmap()
returns table (
  topic text,
  attempts bigint,
  correct bigint,
  accuracy numeric,
  learners bigint
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if not private.is_admin() then
    raise exception 'Nur die Barleitung darf die Team-Auswertung lesen.'
      using errcode = '42501';
  end if;

  return query
  select
    a.topic,
    count(*) as attempts,
    count(*) filter (where a.correct) as correct,
    round(100.0 * count(*) filter (where a.correct) / count(*)) as accuracy,
    count(distinct a.user_id) as learners
  from public.quiz_attempts a
  where a.topic <> ''
  group by a.topic
  order by round(100.0 * count(*) filter (where a.correct) / count(*)) asc, count(*) desc, a.topic asc;
end;
$$;

revoke all on function public.quiz_topic_heatmap() from public;
grant execute on function public.quiz_topic_heatmap() to authenticated;

-- ---------------------------------------------------------------------
-- Schwund-, Bruch- und Verkostungsbuch (Paket 28)
--
-- Jeder Milliliter, der nicht ueber den Tresen verkauft wurde, bekommt hier
-- einen Grund. Damit ist die Inventurdifferenz erklaerbar statt geschaetzt.
-- product_name ist bewusst Text und kein Fremdschluessel: der Katalog wird
-- umbenannt und aufgeraeumt, eine gebuchte Verlustmenge bleibt trotzdem
-- stehen. Die Zuordnung zum Produkt macht das Frontend ueber den Namen.
-- ---------------------------------------------------------------------

create table if not exists public.losses (
  id uuid primary key default gen_random_uuid(),
  product_name text not null,
  amount numeric not null,
  -- ml | cl | Flasche | Glas
  amount_unit text not null default 'ml',
  -- Bruch | Verkostung Gast | Schulung | Retoure/verdorben | Schwund unklar
  reason text not null,
  note text,
  recorded_by uuid references public.profiles (id) on delete set null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists losses_occurred_at_idx on public.losses (occurred_at desc);
create index if not exists losses_product_idx on public.losses (product_name);

alter table public.losses enable row level security;

drop trigger if exists losses_set_updated_at on public.losses;
create trigger losses_set_updated_at
  before update on public.losses
  for each row execute function public.set_updated_at();

-- Jeder Eingeloggte bucht seine eigenen Verluste und sieht alle Buchungen -
-- sonst waere die Summe je Grund sinnlos. Korrigieren und loeschen darf nur,
-- wer den Eintrag geschrieben hat, oder ein Admin: eine Buchung ist ein
-- Nachweis und darf nicht von Dritten stillschweigend verschwinden.
drop policy if exists "losses: any authenticated user can read" on public.losses;
create policy "losses: any authenticated user can read"
  on public.losses for select
  using (auth.role() = 'authenticated');

drop policy if exists "losses: any authenticated user can insert" on public.losses;
create policy "losses: any authenticated user can insert"
  on public.losses for insert
  with check (auth.role() = 'authenticated' and recorded_by = auth.uid());

drop policy if exists "losses: own entry or admin updates" on public.losses;
create policy "losses: own entry or admin updates"
  on public.losses for update
  using (recorded_by = auth.uid() or private.is_admin())
  with check (recorded_by = auth.uid() or private.is_admin());

drop policy if exists "losses: own entry or admin deletes" on public.losses;
create policy "losses: own entry or admin deletes"
  on public.losses for delete
  using (recorded_by = auth.uid() or private.is_admin());

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

do $$
begin
  alter publication supabase_realtime add table public.shift_logs;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.checklist_templates;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.checklist_runs;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.product_prices;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.losses;
exception
  when duplicate_object then null;
end $$;
