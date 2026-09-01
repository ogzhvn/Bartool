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

## 3. Edge Function deployen

Die Funktion `admin-users` legt Mitarbeiterkonten an bzw. löscht sie – dafür
wird der `service_role`-Key gebraucht, der niemals im Frontend landen darf.
Er bleibt als Supabase-Secret serverseitig.

```bash
npx supabase login
npx supabase link --project-ref DEIN-PROJECT-REF
npx supabase functions deploy admin-users
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
2. Im **SQL Editor** die zugehörige `profiles`-Zeile auf `admin` setzen:

   ```sql
   insert into public.profiles (id, email, role)
   values ('<user-id-aus-schritt-1>', 'deine@email.de', 'admin')
   on conflict (id) do update set role = 'admin', email = excluded.email;
   ```

   Das `on conflict` sorgt dafür, dass der Befehl auch dann funktioniert
   (bzw. keinen Fehler wirft), wenn die Zeile aus einem vorherigen Versuch
   schon existiert.

Danach in Bartool mit diesem Konto einloggen. Weitere Konten (Admin oder
Mitarbeiter) lassen sich ab jetzt bequem über den Tab **Admin** in der App
anlegen.

## 6. Sicherheits-Check (empfohlen)

Nach dem Einspielen des Schemas im Dashboard unter **Advisors → Security**
nachsehen. Eine Warnung lässt sich nicht per SQL beheben und sollte manuell
aktiviert werden:

- **Leaked Password Protection**: unter **Authentication → Policies**
  (bzw. **Auth → Settings**) aktivieren – prüft neue Passwörter gegen
  HaveIBeenPwned, kostenlos und ohne Nachteile.

## Rollen

| Rolle | Rechte |
| --- | --- |
| **Admin** | Rezepte & Produkte anlegen/bearbeiten/löschen, Mitarbeiterkonten anlegen/löschen/Rolle ändern |
| **Mitarbeiter** | Rezepte & Produkte lesen, alle Rechner (Batching, Superjuice, Verdünnung & ABV) nutzen |

Ohne Login ist die App nicht nutzbar – es gibt keinen anonymen/öffentlichen
Zugriff mehr.
