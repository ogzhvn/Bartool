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

-- Rollen mit Rangfolge (Paket 35). "rank" entscheidet, wer wen verwalten
-- darf: vergeben, bearbeiten und löschen geht nur für Rollen mit kleinerem
-- Rang als dem eigenen. admin (100) ist die technische Rolle, barchef (80) die
-- fachliche Leitung. Die Labels stehen bewusst hier in der Datenbank und
-- werden nicht übersetzt – wie Produktkatalog und Kategorienamen.
create table if not exists public.roles (
  key text primary key,
  label text not null,
  rank int not null unique,
  is_system boolean not null default false,
  sort int not null default 0
);

-- Ein Recht je Bereich, nicht je Aktion. label_key/group_key zeigen auf
-- Übersetzungsschlüssel im Frontend (js/i18n/de.js, js/i18n/en.js).
create table if not exists public.permissions (
  key text primary key,
  label_key text not null,
  group_key text not null,
  sort int not null default 0
);

create table if not exists public.role_permissions (
  role_key text not null references public.roles (key) on update cascade on delete cascade,
  permission_key text not null references public.permissions (key) on update cascade on delete cascade,
  primary key (role_key, permission_key)
);

insert into public.roles (key, label, rank, is_system, sort) values
  ('admin',          'Administrator',    100, true,  10),
  ('barchef',        'Barchef',           80, false, 20),
  ('stellv_barchef', 'Stellv. Barchef',   60, false, 30),
  ('barkeeper',      'Barkeeper',         40, true,  40),
  ('azubi',          'Auszubildende:r',   20, false, 50)
on conflict (key) do update
  set label = excluded.label,
      rank = excluded.rank,
      is_system = excluded.is_system,
      sort = excluded.sort;

insert into public.permissions (key, label_key, group_key, sort) values
  ('recipes.write',       'perm.recipes.write',       'inhalte',    10),
  ('products.write',      'perm.products.write',      'inhalte',    20),
  ('requests.review',     'perm.requests.review',     'inhalte',    30),
  ('quiz.manage',         'perm.quiz.manage',         'inhalte',    40),
  ('inventory.manage',    'perm.inventory.manage',    'betrieb',    10),
  ('preparations.manage', 'perm.preparations.manage', 'betrieb',    20),
  ('events.manage',       'perm.events.manage',       'betrieb',    30),
  ('checklists.manage',   'perm.checklists.manage',   'betrieb',    40),
  ('shiftlog.manage',     'perm.shiftlog.manage',     'betrieb',    50),
  ('losses.manage',       'perm.losses.manage',       'betrieb',    60),
  ('reports.view',        'perm.reports.view',        'auswertung', 10),
  ('audit.view',          'perm.audit.view',          'auswertung', 20),
  ('audit.restore',       'perm.audit.restore',       'auswertung', 30),
  ('data.manage',         'perm.data.manage',         'verwaltung', 10),
  ('users.manage',        'perm.users.manage',        'verwaltung', 20),
  ('roles.manage',        'perm.roles.manage',        'verwaltung', 30)
on conflict (key) do update
  set label_key = excluded.label_key,
      group_key = excluded.group_key,
      sort = excluded.sort;

-- Startbelegung. admin bekommt alles (auch wenn has_permission() ihn ohnehin
-- immer durchlässt – so stimmt die Matrix in der Oberfläche). barkeeper und
-- azubi behalten nur das, was für "authenticated" offen ist, und brauchen
-- dafür keine Zeile.
insert into public.role_permissions (role_key, permission_key)
select 'admin', key from public.permissions
on conflict do nothing;

insert into public.role_permissions (role_key, permission_key)
select 'barchef', key from public.permissions where key <> 'roles.manage'
on conflict do nothing;

insert into public.role_permissions (role_key, permission_key)
select 'stellv_barchef', key from public.permissions
where key in ('recipes.write', 'products.write', 'requests.review',
              'inventory.manage', 'preparations.manage', 'events.manage',
              'checklists.manage', 'shiftlog.manage', 'losses.manage',
              'reports.view', 'audit.view')
on conflict do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'barkeeper',
  created_at timestamptz not null default now()
);

-- Bestandsinstallation aus der Zeit vor Paket 35: role lag als Enum
-- public.user_role ('admin' | 'mitarbeiter') vor. Reihenfolge zwingend:
-- Default weg, auf text casten, Werte mappen, Default neu, dann FK, dann Enum.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'role' and udt_name = 'user_role'
  ) then
    alter table public.profiles alter column role drop default;
    alter table public.profiles alter column role type text using role::text;
    update public.profiles set role = 'barkeeper' where role = 'mitarbeiter';
    alter table public.profiles alter column role set default 'barkeeper';
  end if;
end $$;

alter table public.profiles drop constraint if exists profiles_role_fkey;
alter table public.profiles add constraint profiles_role_fkey
  foreign key (role) references public.roles (key) on update cascade;

drop type if exists public.user_role;

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;

-- Rang- und Rechtefunktionen leben bewusst in einem eigenen, nicht von
-- PostgREST exponierten Schema statt in "public": Funktionen in "public"
-- werden automatisch als /rest/v1/rpc/<name>-Endpunkt exposed, auch
-- SECURITY DEFINER-Funktionen.
-- In "private" bleiben sie trotzdem ganz normal in RLS-Policies nutzbar
-- (Postgres wertet Policies serverseitig aus, unabhängig vom PostgREST-
-- Schema-Exposure), sind aber nicht direkt von außen aufrufbar.
create schema if not exists private;

-- Alte Version aus "public" entfernen, falls aus einem früheren Setup noch
-- vorhanden (cascade räumt die alten, darauf verweisenden Policies mit weg –
-- die werden weiter unten ohnehin neu angelegt).
drop function if exists public.is_admin() cascade;

-- Rang der eigenen Rolle, 0 wenn nicht angemeldet.
create or replace function private.my_rank()
returns int
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce(
    (select r.rank
       from public.profiles p
       join public.roles r on r.key = p.role
      where p.id = auth.uid()),
    0);
$$;

create or replace function private.role_rank(p_role text)
returns int
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce((select r.rank from public.roles r where r.key = p_role), 0);
$$;

-- Ab Rang 100 (admin) gilt alles als erlaubt, unabhängig von der
-- Rechtetabelle – sonst sperrt ein falsch gesetztes Häkchen die Verwaltung aus.
create or replace function private.has_permission(p text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select private.my_rank() >= 100
      or exists (
        select 1
          from public.profiles pr
          join public.role_permissions rp on rp.role_key = pr.role
         where pr.id = auth.uid()
           and rp.permission_key = p);
$$;

-- is_admin() bedeutet "Rang 100 oder höher" (Paket 35). Seit Paket 36 hängt
-- keine Policy mehr daran – jede prüft ihr eigenes Recht über
-- has_permission(). Die Funktion bleibt als Kurzform für "oberste Ebene"
-- (Frontend: isAdmin()) und für den Trigger unten.
create or replace function private.is_admin()
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select private.my_rank() >= 100;
$$;

grant usage on schema private to authenticated;
revoke all on function private.my_rank() from public;
revoke all on function private.role_rank(text) from public;
revoke all on function private.has_permission(text) from public;
revoke all on function private.is_admin() from public;
grant execute on function private.my_rank() to authenticated;
grant execute on function private.role_rank(text) to authenticated;
grant execute on function private.has_permission(text) to authenticated;
grant execute on function private.is_admin() to authenticated;

-- Konten verwalten (Paket 36): users.manage plus Rangfolge – verwalten darf
-- man nur Konten mit kleinerem Rang als dem eigenen. Ab Rang 100 gilt das
-- ohne Einschränkung, sonst könnte ein Administrator kein zweites
-- Administratorkonto mehr hochstufen.
create or replace function private.can_manage_profile(p_role text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select private.has_permission('users.manage')
     and (private.my_rank() >= 100 or private.role_rank(p_role) < private.my_rank());
$$;

revoke all on function private.can_manage_profile(text) from public;
-- Policies werden mit den Rechten des aufrufenden Kontos ausgewertet: ohne
-- dieses grant scheitert jede Abfrage auf profiles mit
-- "permission denied for function can_manage_profile".
grant execute on function private.can_manage_profile(text) to authenticated;

-- Rollen und Rechte: lesen darf jede angemeldete Person (die Oberfläche muss
-- die eigenen Rechte kennen), schreiben nur mit roles.manage und nur für
-- Rollen unter dem eigenen Rang.
grant select on public.roles, public.permissions, public.role_permissions to authenticated;
grant insert, update, delete on public.roles, public.permissions, public.role_permissions to authenticated;

drop policy if exists "roles: authenticated read" on public.roles;
create policy "roles: authenticated read"
  on public.roles for select to authenticated
  using (true);

drop policy if exists "roles: roles.manage insert" on public.roles;
create policy "roles: roles.manage insert"
  on public.roles for insert to authenticated
  with check (private.has_permission('roles.manage') and rank < private.my_rank());

drop policy if exists "roles: roles.manage update" on public.roles;
create policy "roles: roles.manage update"
  on public.roles for update to authenticated
  using (private.has_permission('roles.manage') and rank < private.my_rank())
  with check (private.has_permission('roles.manage') and rank < private.my_rank());

drop policy if exists "roles: roles.manage delete" on public.roles;
create policy "roles: roles.manage delete"
  on public.roles for delete to authenticated
  using (private.has_permission('roles.manage') and rank < private.my_rank() and not is_system);

drop policy if exists "permissions: authenticated read" on public.permissions;
create policy "permissions: authenticated read"
  on public.permissions for select to authenticated
  using (true);

drop policy if exists "permissions: roles.manage write" on public.permissions;
create policy "permissions: roles.manage write"
  on public.permissions for all to authenticated
  using (private.has_permission('roles.manage'))
  with check (private.has_permission('roles.manage'));

drop policy if exists "role_permissions: authenticated read" on public.role_permissions;
create policy "role_permissions: authenticated read"
  on public.role_permissions for select to authenticated
  using (true);

drop policy if exists "role_permissions: roles.manage insert" on public.role_permissions;
create policy "role_permissions: roles.manage insert"
  on public.role_permissions for insert to authenticated
  with check (private.has_permission('roles.manage') and private.role_rank(role_key) < private.my_rank());

drop policy if exists "role_permissions: roles.manage delete" on public.role_permissions;
create policy "role_permissions: roles.manage delete"
  on public.role_permissions for delete to authenticated
  using (private.has_permission('roles.manage') and private.role_rank(role_key) < private.my_rank());

-- Das letzte Admin-Konto lässt sich weder herabstufen noch löschen. Als
-- Trigger, nicht als Policy: die Edge Function arbeitet mit Service-Role und
-- umgeht damit RLS, einen Trigger aber nicht.
create or replace function private.guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  admin_count int;
begin
  if tg_op = 'UPDATE' then
    if old.role = 'admin' and new.role is distinct from 'admin' then
      select count(*) into admin_count from public.profiles where role = 'admin';
      if admin_count <= 1 then
        raise exception 'Das letzte Administrator-Konto kann nicht herabgestuft werden.';
      end if;
    end if;
    return new;
  end if;

  if old.role = 'admin' then
    select count(*) into admin_count from public.profiles where role = 'admin';
    if admin_count <= 1 then
      raise exception 'Das letzte Administrator-Konto kann nicht gelöscht werden.';
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists profiles_guard_last_admin on public.profiles;
create trigger profiles_guard_last_admin
  before update or delete on public.profiles
  for each row execute function private.guard_last_admin();

drop policy if exists "profiles: read own or admin reads all" on public.profiles;
drop policy if exists "profiles: eigenes oder users.manage liest" on public.profiles;
create policy "profiles: eigenes oder users.manage liest"
  on public.profiles for select
  using (id = auth.uid() or private.has_permission('users.manage'));

-- Anlegen/Ändern/Löschen von Konten läuft über die admin-users Edge
-- Function (Service-Role) bzw. – für reine Rollenänderungen – direkt aus der
-- Kontenliste (per Update). Erlaubt ist beides nur mit users.manage und nur
-- für Konten unterhalb des eigenen Rangs.
drop policy if exists "profiles: admin manages all" on public.profiles;
drop policy if exists "profiles: users.manage verwaltet niedrigere Raenge" on public.profiles;
create policy "profiles: users.manage verwaltet niedrigere Raenge"
  on public.profiles for all
  using (private.can_manage_profile(role))
  with check (private.can_manage_profile(role));

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
-- Oberflächensprache am Profil
-- ---------------------------------------------------------------------
-- Die Sprachwahl (DE/EN) liegt zusätzlich zum localStorage am Profil,
-- damit sie auf jedem Gerät gilt, an dem sich der Nutzer anmeldet.

alter table public.profiles add column if not exists language text not null default 'de';

alter table public.profiles drop constraint if exists profiles_language_check;
alter table public.profiles add constraint profiles_language_check
  check (language in ('de', 'en'));

-- Eng begrenzter RPC: setzt ausschließlich die Sprache des eigenen Profils.
-- Ein generelles Self-Update auf profiles gibt es bewusst nicht (Rolle,
-- Benutzername etc. bleiben Admin-Sache).
create or replace function public.set_my_language(new_language text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if new_language not in ('de', 'en') then
    raise exception 'Unbekannte Sprache: %', new_language;
  end if;
  update public.profiles set language = new_language where id = auth.uid();
end;
$$;

revoke all on function public.set_my_language(text) from public;
revoke execute on function public.set_my_language(text) from anon;
grant execute on function public.set_my_language(text) to authenticated;

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
  -- Englische Zweitfassung (Paket 33): bewusst nur die Felder, die eine
  -- Saisonkraft in der Schicht braucht. Kein jsonb-Sammelfeld – die Felder
  -- sind wenige und bekannt. Leer heisst "nicht gepflegt": die Oberfläche
  -- zeigt dann den deutschen Text mit dem Hinweis "only available in German",
  -- nie stillschweigend Deutsch.
  method_en text,
  glass_en text,
  garnish_en text,
  quick_pitch_en text,
  pairs_with jsonb,
  -- Verkaufspreis brutto in Euro, Grundlage der Kartenkalkulation.
  sales_price numeric,
  -- Fotos (Paket 31): Pfade im privaten Storage-Bucket "bilder",
  -- Schema rezepte/<uuid>.jpg. Aufbaubild (fertiger Drink) und Detailbild
  -- der Garnitur getrennt, weil beide unterschiedliche Motive zeigen.
  image_path text,
  garnish_image_path text,
  created_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.recipes add column if not exists quick_pitch text;
alter table public.recipes add column if not exists pairs_with jsonb;
alter table public.recipes add column if not exists category text;
alter table public.recipes add column if not exists sales_price numeric;
alter table public.recipes add column if not exists image_path text;
alter table public.recipes add column if not exists garnish_image_path text;
alter table public.recipes add column if not exists method_en text;
alter table public.recipes add column if not exists glass_en text;
alter table public.recipes add column if not exists garnish_en text;
alter table public.recipes add column if not exists quick_pitch_en text;

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
drop policy if exists "recipes: recipes.write schreibt" on public.recipes;
create policy "recipes: recipes.write schreibt"
  on public.recipes for all
  using (private.has_permission('recipes.write'))
  with check (private.has_permission('recipes.write'));

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
  -- Foto (Paket 30): Pfad im privaten Storage-Bucket "bilder",
  -- Schema produkte/<uuid>.jpg. Nie der Produktname im Pfad, sonst bricht
  -- jede Umbenennung das Bild.
  image_path text,
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
-- Pfad im privaten Storage-Bucket "bilder", Schema "produkte/<uuid>.jpg".
-- Bewusst nie der Produktname im Pfad, sonst bricht jede Umbenennung das Bild.
alter table public.products add column if not exists image_path text;

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
drop policy if exists "products: products.write schreibt" on public.products;
create policy "products: products.write schreibt"
  on public.products for all
  using (private.has_permission('products.write'))
  with check (private.has_permission('products.write'));

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
drop policy if exists "preparations: preparations.manage loescht" on public.preparations;
create policy "preparations: preparations.manage loescht"
  on public.preparations for delete
  using (private.has_permission('preparations.manage'));

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
drop policy if exists "events: events.manage loescht" on public.events;
create policy "events: events.manage loescht"
  on public.events for delete
  using (private.has_permission('events.manage'));

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
drop policy if exists "shift_logs: shiftlog.manage loescht" on public.shift_logs;
create policy "shift_logs: shiftlog.manage loescht"
  on public.shift_logs for delete
  using (private.has_permission('shiftlog.manage'));

-- ---------------------------------------------------------------------
-- Checklisten Opening/Closing + Nachweisdokumentation
-- ---------------------------------------------------------------------

create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Englischer Vorlagenname (Paket 33), leer = nicht gepflegt.
  name_en text,
  -- opening | closing | reinigung | temperatur | sonstiges
  kind text not null default 'sonstiges',
  -- [{ id, label, labelEn, type: "check" | "wert", unit: "°C", hint: "", hintEn: "", min, max }]
  -- Die englischen Punkte stehen im selben Item wie die deutschen, nicht in
  -- einem eigenen Sammelfeld – sonst laufen Reihenfolge und ids auseinander.
  items jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.checklist_templates add column if not exists name_en text;

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
drop policy if exists "checklist_templates: checklists.manage schreibt" on public.checklist_templates;
create policy "checklist_templates: checklists.manage schreibt"
  on public.checklist_templates for all
  using (private.has_permission('checklists.manage'))
  with check (private.has_permission('checklists.manage'));

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
drop policy if exists "checklist_runs: checklists.manage loescht" on public.checklist_runs;
create policy "checklist_runs: checklists.manage loescht"
  on public.checklist_runs for delete
  using (private.has_permission('checklists.manage'));

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
drop policy if exists "product_prices: products.write schreibt" on public.product_prices;
create policy "product_prices: products.write schreibt"
  on public.product_prices for all
  using (private.has_permission('products.write'))
  with check (private.has_permission('products.write'));

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
drop policy if exists "inventory_counts: inventory.manage loescht" on public.inventory_counts;
create policy "inventory_counts: inventory.manage loescht"
  on public.inventory_counts for delete
  using (private.has_permission('inventory.manage'));

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
drop policy if exists "inventory_items: inventory.manage loescht" on public.inventory_items;
create policy "inventory_items: inventory.manage loescht"
  on public.inventory_items for delete
  using (private.has_permission('inventory.manage'));

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
drop policy if exists "audit_log: audit.view liest alles" on public.audit_log;
create policy "audit_log: audit.view liest alles"
  on public.audit_log for select
  using (private.has_permission('audit.view'));

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

-- Wiederherstellen eines alten Stands (Paket 36). Braucht eine eigene
-- Funktion, weil das Recht audit.restore sonst nicht durchsetzbar wäre: von
-- außen ist ein Wiederherstellen ein ganz normaler Upsert auf
-- recipes/products und von einer Bearbeitung nicht zu unterscheiden.
-- Verlangt audit.restore UND das Schreibrecht des jeweiligen Bereichs.
-- Semantik wie saveRecipe()/saveProduct() im Frontend: Upsert über den Namen,
-- gesetzt werden nur die mitgeschickten Spalten. Der Audit-Trigger
-- protokolliert die Wiederherstellung wie jede andere Änderung.
create or replace function public.restore_row(p_table text, p_row jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perm text;
  v_cols text;
  v_sets text;
begin
  if p_table not in ('recipes', 'products') then
    raise exception 'Wiederherstellen ist nur für Rezepte und Produkte vorgesehen.'
      using errcode = '22023';
  end if;
  if p_row is null or jsonb_typeof(p_row) <> 'object' or coalesce(p_row->>'name', '') = '' then
    raise exception 'Zum Wiederherstellen fehlt der Name.' using errcode = '22023';
  end if;

  v_perm := case p_table when 'recipes' then 'recipes.write' else 'products.write' end;
  if not private.has_permission('audit.restore') or not private.has_permission(v_perm) then
    raise exception 'Fehlendes Recht zum Wiederherstellen.' using errcode = '42501';
  end if;

  -- Nur echte Spalten der Zieltabelle, und nur die, die auch mitgeschickt
  -- wurden. So kann ein Aufruf keine Spalte auf null zurücksetzen, die er
  -- gar nicht kennt.
  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
         string_agg(
           quote_ident(c.column_name) || ' = excluded.' || quote_ident(c.column_name),
           ', ' order by c.ordinal_position
         )
    into v_cols, v_sets
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = p_table
     and c.column_name not in ('id', 'name')
     and c.is_generated = 'NEVER'
     and p_row ? c.column_name;

  if v_cols is null then
    raise exception 'Zum Wiederherstellen sind keine Felder angekommen.' using errcode = '22023';
  end if;

  execute format(
    'insert into public.%1$I (name, %2$s) select r.name, %2$s from jsonb_populate_record(null::public.%1$I, $1) r on conflict (name) do update set %3$s',
    p_table, v_cols, v_sets
  ) using p_row;
end;
$$;

revoke all on function public.restore_row(text, jsonb) from public;
grant execute on function public.restore_row(text, jsonb) to authenticated;

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
drop policy if exists "change_requests: eigene oder requests.review" on public.change_requests;
create policy "change_requests: eigene oder requests.review"
  on public.change_requests for select
  using (proposed_by = auth.uid() or private.has_permission('requests.review'));

drop policy if exists "change_requests: admin update" on public.change_requests;
drop policy if exists "change_requests: requests.review entscheidet" on public.change_requests;
create policy "change_requests: requests.review entscheidet"
  on public.change_requests for update
  using (private.has_permission('requests.review'))
  with check (private.has_permission('requests.review'));

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
drop policy if exists "quiz_questions: quiz.manage schreibt" on public.quiz_questions;
create policy "quiz_questions: quiz.manage schreibt"
  on public.quiz_questions for all
  using (private.has_permission('quiz.manage'))
  with check (private.has_permission('quiz.manage'));

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
drop policy if exists "quiz_attempts: quiz.manage loescht" on public.quiz_attempts;
create policy "quiz_attempts: quiz.manage loescht"
  on public.quiz_attempts for delete
  using (private.has_permission('quiz.manage'));

-- ---------------------------------------------------------------------
-- ---------------------------------------------------------------------
-- Sichtbarkeit in der Quiz-Auswertung (Paket 40)
-- ---------------------------------------------------------------------
-- Die Barleitung taucht in den Team-Auswertungen standardmaessig nicht auf.
-- quiz_visible ist bewusst nullable: NULL heisst "richte dich nach der Rolle",
-- true/false ist die Uebersteuerung von Hand. Wer befoerdert wird,
-- verschwindet damit von selbst aus der Auswertung.
--
-- Geschrieben werden darf die Spalte nur ueber die vorhandene Policy
-- "profiles: users.manage verwaltet niedrigere Raenge", also mit dem Recht
-- users.manage. Die Sichtbarkeit ist eine Entscheidung der Barleitung, kein
-- Selbstbedienungsschalter.

alter table public.profiles add column if not exists quiz_visible boolean;

-- Ausgeblendet wird nach Rang >= 60, nicht nach dem Recht reports.view: ein
-- Barkeeper, der Auswertungen sehen darf, soll trotzdem in der Rangliste
-- stehen.
create or replace function private.quiz_sichtbar(p_role text, p_flag boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_flag, private.role_rank(p_role) < 60);
$$;

revoke all on function private.quiz_sichtbar(text, boolean) from public;
grant execute on function private.quiz_sichtbar(text, boolean) to authenticated;

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
  weakest_topics jsonb,
  -- Paket 40: die Verwaltungssicht bleibt vollstaendig, kennzeichnet aber,
  -- wer in Heatmap und Rangliste nicht auftaucht.
  hidden boolean
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  -- Zahlen über das Team sind eine Auswertung, keine Systemverwaltung
  -- (Paket 36): reports.view statt is_admin(). Einzelantworten gibt die
  -- Datenbank weiterhin niemandem heraus.
  if not private.has_permission('reports.view') then
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
    coalesce(s.weakest_topics, '[]'::jsonb),
    not private.quiz_sichtbar(p.role, p.quiz_visible)
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
  -- Zahlen über das Team sind eine Auswertung, keine Systemverwaltung
  -- (Paket 36): reports.view statt is_admin(). Einzelantworten gibt die
  -- Datenbank weiterhin niemandem heraus.
  if not private.has_permission('reports.view') then
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
  join public.profiles p on p.id = a.user_id
  where a.topic <> ''
    -- Ausgeblendete Personen fliessen gar nicht erst in die Themenzahlen ein.
    and private.quiz_sichtbar(p.role, p.quiz_visible)
  group by a.topic
  order by round(100.0 * count(*) filter (where a.correct) / count(*)) asc, count(*) desc, a.topic asc;
end;
$$;

revoke all on function public.quiz_topic_heatmap() from public;
grant execute on function public.quiz_topic_heatmap() to authenticated;

-- ---------------------------------------------------------------------
-- Rangliste im Quiz (Paket 41)
-- ---------------------------------------------------------------------
-- Steht im Quiz-Tab fuer jeden angemeldeten Nutzer und ist damit die erste
-- Team-Auswertung ohne das Recht reports.view. Genau deshalb gibt sie nur
-- Summen je Person heraus: keine einzelnen Antworten, keine Themen, keine
-- E-Mail-Adresse. Die select-Policy auf quiz_attempts bleibt unangetastet.
--
-- Gefiltert wird ueber dieselbe Regel wie Heatmap und Team-Uebersicht; die
-- eigene Zeile kommt immer mit, sonst saehe eine ausgeblendete Barleitung
-- ihren eigenen Stand nirgends. Die Mindestzahl an Versuchen fuer einen
-- Quotenplatz steckt in der Anzeige (js/quizStats.js), nicht hier.

create or replace function public.quiz_leaderboard(p_zeitraum text default 'gesamt')
returns table (
  user_id uuid,
  display_name text,
  attempts bigint,
  correct bigint,
  accuracy numeric,
  rounds bigint,
  last_answered_at timestamptz,
  ist_selbst boolean
)
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_zeitraum text := lower(coalesce(p_zeitraum, 'gesamt'));
  v_von timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Nur angemeldete Nutzer sehen die Rangliste.'
      using errcode = '42501';
  end if;

  if v_zeitraum not in ('gesamt', '30tage', 'monat') then
    raise exception 'Unbekannter Zeitraum: %', p_zeitraum
      using errcode = '22023';
  end if;

  v_von := case v_zeitraum
    when '30tage' then now() - interval '30 days'
    when 'monat' then date_trunc('month', now())
    else null
  end;

  return query
  with basis as (
    select
      a.user_id as uid,
      a.correct as correct,
      a.answered_at as answered_at,
      coalesce(a.round_id::text, 'h:' || date_trunc('hour', a.answered_at)::text) as rundenschluessel
    from public.quiz_attempts a
    where v_von is null or a.answered_at >= v_von
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
  )
  select
    p.id,
    -- Anzeigename, ersatzweise Benutzername. Nie die E-Mail: die Liste sehen alle.
    coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(p.username), '')),
    jp.attempts,
    jp.correct,
    round(100.0 * jp.correct / jp.attempts),
    jp.rounds,
    jp.last_answered_at,
    p.id = auth.uid()
  from je_person jp
  join public.profiles p on p.id = jp.uid
  where private.quiz_sichtbar(p.role, p.quiz_visible) or p.id = auth.uid()
  order by jp.correct desc, jp.attempts desc, jp.last_answered_at desc nulls last;
end;
$$;

revoke all on function public.quiz_leaderboard(text) from public;
-- Die Default-Privilegien des Projekts geben neuen Funktionen auch anon mit;
-- die Rangliste ist ausschliesslich fuer angemeldete Nutzer.
revoke all on function public.quiz_leaderboard(text) from anon;
grant execute on function public.quiz_leaderboard(text) to authenticated;

-- ---------------------------------------------------------------------
-- Gemessene Schwierigkeit je Frage (Paket 43)
-- ---------------------------------------------------------------------
-- Bis hierher war difficulty im Generator geraten: ein fester Wert je
-- Fragetyp. Diese Funktion misst stattdessen, woran das Team wirklich
-- scheitert, und zwar ueber dieselbe Sichtbarkeitsregel wie Heatmap und
-- Rangliste (private.quiz_sichtbar) - ausgeblendete Personen zaehlen nicht mit.
--
-- Zwei Schwellen, beide noetig:
--   * mindestens 10 Versuche  -> unter zehn Antworten ist eine Quote Rauschen,
--   * mindestens 3 Lernende   -> ein Aggregat aus zehn Versuchen einer
--     einzigen Person waere faktisch personenbezogen. Genau das gibt die
--     Auswertung nicht heraus; die select-Policy auf quiz_attempts bleibt
--     unangetastet.
--
-- Der Fragetext steht bewusst nicht in quiz_attempts (dort liegt nur der
-- question_key). Er wird im Frontend aus dem aktuellen Fragenpool
-- rekonstruiert; Keys ohne Treffer bleiben sichtbar, statt zu verschwinden.

create or replace function public.quiz_question_difficulty()
returns table (
  question_key text,
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
declare
  -- Beide Schwellen stehen hier und nicht im Frontend: eine Zeile, die die
  -- Funktion nicht herausgibt, kann auch niemand versehentlich anzeigen.
  c_min_versuche constant bigint := 10;
  c_min_lernende constant bigint := 3;
begin
  if not private.has_permission('reports.view') then
    raise exception 'Nur die Barleitung darf die Schwierigkeit je Frage lesen.'
      using errcode = '42501';
  end if;

  return query
  select
    a.question_key,
    -- Das Thema wandert mit dem Katalog (ein Produkt wechselt die Gruppe);
    -- massgeblich ist deshalb das zuletzt gespeicherte.
    (array_agg(a.topic order by a.answered_at desc))[1] as topic,
    count(*)::bigint as attempts,
    count(*) filter (where a.correct)::bigint as correct,
    round(100.0 * count(*) filter (where a.correct) / count(*)) as accuracy,
    count(distinct a.user_id)::bigint as learners
  from public.quiz_attempts a
  join public.profiles p on p.id = a.user_id
  where a.question_key <> ''
    and private.quiz_sichtbar(p.role, p.quiz_visible)
  group by a.question_key
  having count(*) >= c_min_versuche
     and count(distinct a.user_id) >= c_min_lernende
  -- Aufsteigend nach Quote: oben steht, woran das Team scheitert.
  order by round(100.0 * count(*) filter (where a.correct) / count(*)) asc,
           count(*) desc,
           a.question_key asc;
end;
$$;

revoke all on function public.quiz_question_difficulty() from public;
-- Die Default-Privilegien des Projekts geben neuen Funktionen auch anon mit.
revoke all on function public.quiz_question_difficulty() from anon;
grant execute on function public.quiz_question_difficulty() to authenticated;

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
drop policy if exists "losses: eigene oder losses.manage aendert" on public.losses;
create policy "losses: eigene oder losses.manage aendert"
  on public.losses for update
  using (recorded_by = auth.uid() or private.has_permission('losses.manage'))
  with check (recorded_by = auth.uid() or private.has_permission('losses.manage'));

drop policy if exists "losses: own entry or admin deletes" on public.losses;
drop policy if exists "losses: eigene oder losses.manage loescht" on public.losses;
create policy "losses: eigene oder losses.manage loescht"
  on public.losses for delete
  using (recorded_by = auth.uid() or private.has_permission('losses.manage'));

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

-- ---------------------------------------------------------------------
-- Produktfotos: privater Storage-Bucket, Zugriff nur über signierte URLs
-- ---------------------------------------------------------------------
-- Bewusst kein öffentlicher Bucket: Bilder sollen nicht ohne Login abrufbar
-- sein, auch nicht bei Kenntnis der URL. js/photos.js löst image_path daher
-- immer über eine zeitlich begrenzte signierte URL auf.

insert into storage.buckets (id, name, public)
values ('bilder', 'bilder', false)
on conflict (id) do nothing;

drop policy if exists "bilder: eingeloggte lesen" on storage.objects;
create policy "bilder: eingeloggte lesen"
  on storage.objects for select
  using (bucket_id = 'bilder' and auth.role() = 'authenticated');

drop policy if exists "bilder: admin schreibt" on storage.objects;
drop policy if exists "bilder: fotorecht schreibt" on storage.objects;
create policy "bilder: fotorecht schreibt"
  on storage.objects for insert
  with check (
    bucket_id = 'bilder'
    and (
      (split_part(name, '/', 1) = 'produkte' and private.has_permission('products.write'))
      or (split_part(name, '/', 1) = 'rezepte' and private.has_permission('recipes.write'))
    )
  );

drop policy if exists "bilder: admin aktualisiert" on storage.objects;
drop policy if exists "bilder: fotorecht aktualisiert" on storage.objects;
create policy "bilder: fotorecht aktualisiert"
  on storage.objects for update
  using (
    bucket_id = 'bilder'
    and (
      (split_part(name, '/', 1) = 'produkte' and private.has_permission('products.write'))
      or (split_part(name, '/', 1) = 'rezepte' and private.has_permission('recipes.write'))
    )
  )
  with check (
    bucket_id = 'bilder'
    and (
      (split_part(name, '/', 1) = 'produkte' and private.has_permission('products.write'))
      or (split_part(name, '/', 1) = 'rezepte' and private.has_permission('recipes.write'))
    )
  );

drop policy if exists "bilder: admin loescht" on storage.objects;
drop policy if exists "bilder: fotorecht loescht" on storage.objects;
create policy "bilder: fotorecht loescht"
  on storage.objects for delete
  using (
    bucket_id = 'bilder'
    and (
      (split_part(name, '/', 1) = 'produkte' and private.has_permission('products.write'))
      or (split_part(name, '/', 1) = 'rezepte' and private.has_permission('recipes.write'))
    )
  );
