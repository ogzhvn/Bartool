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
