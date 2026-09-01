# Bartool

Eine werkzeuglose Web-App mit Rechnern und einem Rezept-/Produktbuch für Barkeeper:

- **Batching** – Rezepte auf mehr Portionen oder ein Ziel-Volumen hochrechnen
- **Rezepte & Produkte** – zentral in Supabase gespeichert, für alle eingeloggten Nutzer sichtbar
- **Superjuice** – Säuremengen (Zitronensäure, Apfelsäure, Ascorbinsäure) und optional Zucker für Superjuice berechnen
- **Verdünnung & ABV** – Alkoholgehalt eines Drinks vor/nach Verdünnung durch Eis berechnen
- **Admin-Panel** – Mitarbeiterkonten anlegen, Rollen verwalten

## Rollen & Login

Die App erfordert ein Konto (kein anonymer Zugriff mehr):

- **Admin** – kann Rezepte/Produkte bearbeiten und Mitarbeiterkonten anlegen
- **Mitarbeiter** – kann lesen und alle Rechner nutzen

Konten werden von einem Admin über den **Admin**-Tab in der App angelegt.
Wie das erste Admin-Konto entsteht, steht in [`supabase/README.md`](./supabase/README.md).

## Nutzung

Reines HTML/CSS/JavaScript ohne Build-Schritt, aber mit Supabase als Backend
(Datenbank, Auth, Realtime, Edge Functions – kein eigener Node-Server).

1. Supabase-Projekt einrichten: siehe [`supabase/README.md`](./supabase/README.md).
2. Lokal starten, z. B.:

   ```bash
   python3 -m http.server 8000
   ```

   Dann `http://localhost:8000` im Browser öffnen.

## Deployment

Da es weiterhin eine statische Seite ist, kann sie direkt z. B. über GitHub Pages gehostet werden (Settings → Pages → Branch auswählen). Das Supabase-Projekt läuft unabhängig davon in der Cloud.
