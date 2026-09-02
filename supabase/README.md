# Supabase-Setup für Bartool

Bartool bleibt eine statische Seite (z. B. auf GitHub Pages), die
Rezepte/Produkte aber jetzt zentral in einem Supabase-Projekt liegen statt
im `localStorage` des Browsers. Es gibt keinen eigenen Node-Server – die
komplette Backend-Logik läuft in Supabase (Postgres, Auth, Realtime, Edge
Functions).

## 1. Projekt anlegen

1. Auf [supabase.com](https://supabase.com) ein neues Projekt anlegen.
2. Unter **Project Settings → API** die **Project URL** und den **anon
   public**-Key notieren.

## 2. Datenbank-Schema einspielen

Im Supabase-Dashboard unter **SQL Editor** den Inhalt von
[`schema.sql`](./schema.sql) einfügen und ausführen. Das legt an:

- `profiles` – ein Datensatz pro Nutzer:in mit Rolle (`admin` oder
  `mitarbeiter`)
- `recipes` / `products` – die eigentlichen Daten, per Row Level Security
  so abgesichert, dass jeder eingeloggte Nutzer lesen, aber nur Admins
  schreiben dürfen
- eine `private.is_admin()`-Hilfsfunktion, die die Policies benutzen (bewusst
  in einem eigenen, nicht öffentlich per REST-API aufrufbaren Schema statt in
  `public`)

## 3. Edge Functions deployen

Zwei Functions, beide nutzen den `service_role`-Key serverseitig, der
niemals im Frontend landen darf:

- `admin-users` – legt Mitarbeiterkonten an bzw. löscht sie.
- `login-with-username` – löst beim Login den Benutzernamen auf die
  hinterlegte E-Mail auf (Bartool loggt sich per Benutzername statt E-Mail
  ein). Läuft ohne JWT-Prüfung, da der Aufrufer beim Login noch nicht
  angemeldet ist.

```bash
npx supabase login
npx supabase link --project-ref DEIN-PROJECT-REF
npx supabase functions deploy admin-users
npx supabase functions deploy login-with-username --no-verify-jwt
```

Supabase stellt `SUPABASE_URL`, `SUPABASE_ANON_KEY` und
`SUPABASE_SERVICE_ROLE_KEY` Edge Functions automatisch als Umgebungsvariable
zur Verfügung – hier muss nichts manuell gesetzt werden.

## 4. Frontend konfigurieren

In [`js/supabaseConfig.js`](../js/supabaseConfig.js) `SUPABASE_URL` und
`SUPABASE_ANON_KEY` aus Schritt 1 eintragen und committen. Der anon-Key ist
öffentlich und darf im Repo stehen – der Zugriff wird über RLS geregelt.

## 5. Ersten Admin-Account anlegen

Es muss ein erster Admin von Hand angelegt werden, da das Anlegen weiterer
Konten selbst schon Admin-Rechte voraussetzt:

1. Im Supabase-Dashboard unter **Authentication → Users → Add user** einen
   Nutzer mit E-Mail + Passwort anlegen (Auto Confirm aktivieren).
2. Im **SQL Editor** die zugehörige `profiles`-Zeile auf `admin` setzen
   (Benutzername frei wählbar, wird für den Login in Bartool gebraucht):

   ```sql
   insert into public.profiles (id, email, username, role, must_change_password)
   values ('<user-id-aus-schritt-1>', 'deine@email.de', '<dein-benutzername>', 'admin', false)
   on conflict (id) do update set role = 'admin', email = excluded.email, username = excluded.username;
   ```

   Das `on conflict` sorgt dafür, dass der Befehl auch dann funktioniert
   (bzw. keinen Fehler wirft), wenn die Zeile aus einem vorherigen Versuch
   schon existiert.

Danach in Bartool mit dem gewählten **Benutzernamen** (nicht der E-Mail)
und dem Passwort aus Schritt 1 einloggen. Weitere Konten (Admin oder
Mitarbeiter) lassen sich ab jetzt bequem über den Tab **Admin** in der App
anlegen – dort wird pro Konto auch ein Benutzername vergeben. Über den Tab
angelegte Konten müssen ihr temporäres Passwort beim ersten Login ändern
(erzwungener Passwortwechsel-Screen); Mitarbeitende können ihr Passwort
danach jederzeit über "Passwort ändern" im Header selbst ändern. Aus
Sicherheitsgründen (öffentlich zugängliches Tresen-Tablet) meldet Bartool
nach 6h Inaktivität automatisch ab.

## 6. Sicherheits-Check (empfohlen)

Nach dem Einspielen des Schemas im Dashboard unter **Advisors → Security**
nachsehen.

- **Leaked Password Protection**: prüft neue Passwörter gegen
  HaveIBeenPwned. Steht auf dem Supabase Free-Tier nicht zur Verfügung –
  als Ausgleich erzwingt Bartool selbst einen Passwortwechsel bei jedem neu
  angelegten Konto (siehe oben) und eine Mindestlänge von 10 Zeichen.
  Perspektivisch (Supabase Pro-Tier) nachträglich aktivierbar.
- **MFA (TOTP) für Admin-Konten**: unter **Authentication → Settings**
  aktivieren und für die eigenen Admin-Accounts einrichten – auf allen
  Tiers verfügbar, guter zusätzlicher Schutz gerade für die Konten mit den
  weitreichendsten Rechten.

## Rollen

| Rolle | Rechte |
| --- | --- |
| **Admin** | Rezepte & Produkte anlegen/bearbeiten/löschen, Mitarbeiterkonten anlegen/löschen/Rolle ändern |
| **Mitarbeiter** | Rezepte & Produkte lesen, alle Rechner (Batching, Superjuice, Verdünnung & ABV) nutzen |

Ohne Login ist die App nicht nutzbar – es gibt keinen anonymen/öffentlichen
Zugriff mehr.
