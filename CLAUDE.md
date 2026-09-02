# Bartool – Hinweise für Claude Code

## Was ist das
Bar-Operations-Tool: Batching-, ABV- und Dilution-Rechner. Frontend als self-contained HTML/JS, dark-themed. Backend: Supabase (Postgres).

## Einsatzkontext
- Läuft gleichwertig auf Handy/Tablet hinterm Tresen und auf Desktop/Laptop – UI muss auf beiden gut bedienbar sein (Touch-Targets, responsives Layout).
- Wird im laufenden Barbetrieb genutzt: schnelle Ladezeit, robust gegen Fehleingaben.

## Datenhaltung
- Backend: Supabase (Postgres). Eingaben, Werte und eigene Rezepte werden dauerhaft in der Datenbank gespeichert.
- Frontend verbindet sich nur mit SUPABASE_URL + anon/public Key. Service-Role-Key und DB-Passwort gehören niemals in den Client-Code.
- Row Level Security ist für alle Tabellen aktiv.
- Claude Code hat über MCP direkten Zugriff auf das Supabase-Projekt (project_ref-gescoped). Für Schema-Änderungen die MCP-Verbindung nutzen, keine ungescopten Rohzugriffe.

## Skills
Eigene Claude Code Skills existieren für: Cocktail-Batch-Math, UI-Design, Recipe Export/Print (Details siehe jeweilige .skill-Dateien im Projekt).

## Konventionen
- Frontend als Einzeldatei-Ansatz beibehalten, sofern nicht explizit anders gewünscht.
- Dark Theme als Standard-Look nicht ohne Rückfrage ändern.

## Daten: Rezepte & Produkte gehören in Supabase

Wichtige Nutzervorgabe: **Neue Rezepte und Produkte sollen immer in die
Supabase-Datenbank geschrieben werden**, nicht (nur) als statische Einträge
in den JS-Dateien (`js/classicsData.js`, `js/houseRecipes.js`,
`js/productsData.js`) ergänzt werden.

Hintergrund/Architektur (Stand jetzt):

- `js/storage.js` liest/schreibt Rezepte über die Supabase-Tabelle
  `recipes` (`saveRecipe()` → `supabase.from("recipes").upsert(...)`) und
  Produkte über die Tabelle `products`.
- `js/recipeLibrary.js` führt beim Anzeigen drei Quellen zusammen:
  eigene/DB-Rezepte (`loadRecipes()`) > `HOUSE_RECIPES` (statisch,
  `js/houseRecipes.js`) > `CLASSIC_RECIPES` (statisch, `js/classicsData.js`).
  Ein DB-Rezept mit gleichem Namen überschreibt die statische Version.
- Bisher lag die große Klassiker-/Hausrezept-Sammlung rein statisch im
  Code (kein DB-Eintrag nötig, damit sie in der App erscheint).

**Für zukünftige Aufgaben:** Wenn neue Rezepte oder Produkte hinzugefügt
werden sollen, diese direkt in die Supabase-Tabellen `recipes` bzw.
`products` schreiben (z. B. über die Supabase-MCP-Tools oder die App
selbst), statt sie nur in die statischen JS-Dateien einzutragen. Das
Zutaten-/Ingredient-Namensschema muss dabei weiterhin exakt mit den
Produktnamen aus `products` (bzw. `js/productsData.js`) übereinstimmen,
damit Aromenmatrix/Verkaufsmatrix/Empfehlungssystem korrekt zuordnen
können. Bei fehlenden Original-Zutaten im Sortiment: sinnvolle Annäherung
wählen und das in der `history`/Beschreibung transparent vermerken.

# Persönliche Arbeitsweise

## Kommunikation
- Antworte kurz und direkt. Keine Einleitungssätze, keine Wiederholung der Aufgabe, keine Zusammenfassung am Ende, außer explizit gewünscht.
- Kein Hedging, keine Floskeln ("das ist eine gute Frage" etc.).
- Technisches Vokabular ohne Erklärung verwenden – ich arbeite selbst mit Claude Code.
- Antworten auf Deutsch, außer Code/Fachbegriffe.

## Arbeitsweise bei Code-Änderungen
- Änderungen direkt umsetzen, nicht erst lang planen oder nachfragen.
- Nur bei größeren/strukturellen Entscheidungen (z. B. neue Architektur, größere Refactorings, Risiko von Datenverlust) vorher kurz nachfragen.
- Nach Abschluss: kurze Zusammenfassung, was gemacht wurde – keine ausführliche Erklärung, außer gefragt.

## Git
- Änderungen automatisch committen, mit klaren, aussagekräftigen Commit-Messages (kurzer Titel + bei Bedarf 1–2 Zeilen Kontext).
- Keine Commits auf einem nicht funktionierenden Zwischenstand.

## Hintergrund
- Barkeeper (A-ROSA Travemünde), bereite IHK-Externenprüfung zum Hotelfachmann vor.
- Aktuelles Projekt: Bartool (siehe projekteigene CLAUDE.md).
