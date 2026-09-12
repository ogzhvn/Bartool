# Bartool – Arbeitsanweisung für Claude Code

## Projekt in drei Sätzen
Bar-Operations-Tool für A-ROSA Travemünde: Rechner (Batching, Superjuice,
Zuckersirup, Verdünnung/ABV, Kalkulation) + Rezept- und Produktbibliothek.
Frontend: statisches HTML/CSS/Vanilla-JS, **kein Build-Schritt**, dark theme.
Backend: Supabase (Postgres, Auth, RLS, Edge Functions). Deployment: GitHub Pages.

Läuft hinterm Tresen auf Handy/Tablet **und** auf Desktop → Touch-Targets,
responsives Layout, schnelle Ladezeit, robust gegen Fehleingaben.

## Architektur-Map (hier zuerst nachsehen, nicht suchen)

| Was | Wo |
|---|---|
| Einstieg, Modul-Init, Auth-Gating, `data-perm`-Gating | `js/main.js` |
| Tab-Umschaltung (`data-tab` ↔ `.tab-panel`), Navigation | `js/tabs.js`, `js/headerMenu.js` |
| Alle Markup-/Tab-Definitionen | `index.html` |
| Styling, Theme-Variablen | `css/styles.css` |
| DB-Zugriff **aller** Datenarten, Offline-Cache | `js/storage.js` |
| Supabase-Client + Keys | `js/supabaseClient.js`, `js/supabaseConfig.js` |
| Login, Session, `can()` / `canAny()` | `js/auth.js` |
| Rollen, Rechtekatalog | `js/roles.js`, `js/permissions.js` |
| Startseite, Favoriten, „Heute anstehend" | `js/home.js`, `js/favorites.js` |
| Rechner | `js/batching.js`, `superjuice.js`, `syrup.js`, `dilution.js`, `calculation.js` |
| ABV-Mathematik (zentral) | `js/abv.js`, Einheiten in `js/units.js` |
| Kalkulation, Karte, Preise | `js/costing.js`, `menuCosting.js`, `priceHistory.js` |
| Bibliothek (Merge DB+statisch) | `js/recipeLibrary.js`, `js/productLibrary.js` |
| Rezept-/Produktpflege, Zutateneditor | `js/recipes.js`, `products.js`, `ingredientEditor.js` |
| Statische Daten (GROSS, s.u.) | `js/classicsData.js`, `js/houseRecipes.js`, `js/productsData.js` |
| Betrieb: Ansätze, Events, Übergabe, Checklisten | `js/preparations.js`, `events.js`, `shiftLog.js`, `checklists.js` |
| Bestand: Inventur, Bestellung, Schwund, „Was kann ich bauen?" | `js/inventory.js`, `ordering.js`, `losses.js`, `buildable.js` |
| Quiz | `js/quiz.js`, `quizGenerator.js`, `quizStats.js`, `adminQuiz.js` |
| Allergene, Fotos, Suche, Druck | `js/allergens.js`, `photos.js`, `quickSearch.js`, `printView.js` |
| Import/Export (xlsx) | `js/productImport.js`, `productExport.js`, `recipeExport.js` |
| Mehrsprachigkeit DE/EN | `js/i18n.js`, `js/i18n/de.js`, `js/i18n/en.js`, `js/language.js` |
| Admin (Sub-Tabs), Audit, Änderungsanträge | `js/adminPanel.js`, `adminSections.js`, `adminUsers.js`, `adminRoles.js`, `adminReports.js`, `auditLog.js`, `changeRequests.js`, `dataQuality.js` |
| Hilfsfunktionen (`escapeHtml`, Zahlen) | `js/utils.js` |
| PWA-Shell, Cache-Version | `sw.js`, `manifest.json` |
| DB-Schema + RLS + Setup | `supabase/schema.sql`, `supabase/README.md` |
| Edge Functions | `supabase/functions/{admin-users,login-with-username}` |
| Ausbauplan (Ist-Stand, Pakete) | `docs/AUSBAUPLAN.md` |
| Historische Docs (**nicht** Ist-Stand) | `docs/archive/` |

**Ein Feature = ein Modul unter `js/` mit einer `initX()`-Funktion + Import in
`main.js` + `<button data-tab>` und `<section class="tab-panel">` in `index.html`.**
Dieses Muster nie durchbrechen.

`storage.js` folgt pro Datentyp demselben Muster: `load*()` / `save*()` /
`delete*()` / `on*Changed()` / `init*Sync()`. Neue Datenarten genauso bauen.

## Harte Regeln

1. **Kein Build-Schritt, keine Frameworks, keine npm-Dependencies im Frontend.**
   Externe Libs nur per CDN-`<script>` (aktuell: supabase-js, xlsx).
2. **Secrets:** Nur `SUPABASE_URL` + anon/public Key im Client. Service-Role-Key
   und DB-Passwort niemals in Frontend-Code oder Commits.
3. **RLS ist für alle Tabellen aktiv.** Schema-Änderungen ausschließlich über die
   Supabase-MCP-Tools (project_ref-gescoped) + Migration, nie ungescopte Rohzugriffe.
   Nach jeder Schema-Änderung `supabase/schema.sql` mitziehen.
4. **Dark Theme und Layout-Grundgerüst nicht ohne Rückfrage ändern.**
5. **Nutzereingaben nie als HTML einsetzen** (`textContent` statt `innerHTML`,
   sonst escapen). Es gab hier schon einen stored-XSS-Fix.
6. **Produktdaten nie erfinden oder schätzen.** Nur was in den echten Bestell-/
   Sortimentslisten steht oder was der Nutzer explizit bestätigt hat. Bei fehlender
   Original-Zutat: sinnvolle Annäherung wählen und im `history`-/Beschreibungsfeld
   transparent vermerken.
7. **Neue Rezepte und Produkte gehören in die Supabase-Tabellen `recipes` /
   `products`**, nicht in die statischen JS-Dateien. Die statischen Dateien sind
   Altbestand; DB-Einträge mit gleichem Namen überschreiben sie
   (`recipeLibrary.js`: DB > `HOUSE_RECIPES` > `CLASSIC_RECIPES`).
   **Der komplette Katalog aus `productsData.js`/`classicsData.js`/
   `houseRecipes.js` liegt inzwischen zusätzlich 1:1 in der DB gespiegelt**
   (Stand 09/2026: 367 Produkte und 163 Rezepte in der DB, alle Einträge der
   statischen Dateien haben einen DB-Eintrag
   mit identischem Namen). Das bedeutet: **eine Änderung nur in der statischen
   Datei ist im Live-Tool unsichtbar**, weil die DB-Version sie überschreibt.
   Vor jeder inhaltlichen Änderung an einem bestehenden Rezept/Produkt per
   `execute_sql` prüfen, ob ein DB-Eintrag mit dem Namen existiert
   (`select name from products where name = '...'`), und falls ja, die
   geänderten Felder dort **immer per `UPDATE ... WHERE name = '...'` mitziehen**
   – nicht nur in der JS-Datei. Bei vielen betroffenen Zeilen ein Skript
   nutzen, das die SQL-Statements aus den JS-Objekten generiert (siehe
   Vorgehen bei der Wein-Ausbau-Aktion), statt Statements einzeln zu tippen.
   Diese Regel gilt für **jede** Session, nicht nur die aktuelle.
8. **Zutatennamen müssen exakt zu Produktnamen aus `products` passen.** Das
   Matching ist ein strikter Teilstring-Vergleich
   (`ingredient.name.toLowerCase().includes(product.name.toLowerCase())`).
   Generisch ("Gin") matcht nicht – immer die Hausmarke ("Bombay Sapphire Gin").
   Produktnamen vor dem Schreiben per `grep -n` in `js/productsData.js` bzw.
   in der DB verifizieren, nie aus dem Kopf tippen: ein falsch geratener Name
   bricht das Matching still, ohne Fehlermeldung.
9. **Features immer über `getAllRecipes()` / `getAllProducts()` lesen**, nie direkt
   aus den Daten-Dateien.
10. **Kein Commit auf einem nicht lauffähigen Zwischenstand.** Vor dem Commit:
    App gedanklich durchspielen bzw. `python3 -m http.server 8000` und klicken.
11. **Oberflächentexte laufen über i18n.** Feste Beschriftungen in `index.html`
    tragen `data-i18n="key"` (bzw. `data-i18n-placeholder/-title/-aria-label`),
    Texte aus JS kommen aus `t("key")`. Neue Schlüssel gehören in **beide**
    Sprachdateien; Zahlen/Datum/Währung nie von Hand formatieren, sondern über
    `formatDecimal/formatDate/formatCurrency` aus `js/i18n.js`. Ein Modul, das
    Markup nachträglich baut, rendert bei `onLanguageChanged()` neu.
    Kategorien, Produkt- und Rezeptinhalte bleiben bewusst deutsch.

## Kontext-Budget (wichtig – hier wird das meiste Geld verbrannt)

Drei Dateien sind riesig und dürfen **nie komplett gelesen** werden:
`js/productsData.js` (~340 KB), `js/classicsData.js` (~127 KB),
`index.html` (~105 KB). Auch `css/styles.css` (~65 KB) nur gezielt. Auch `js/products.js` und `js/recipes.js` nur gezielt.

Stattdessen:

```bash
grep -n "Bombay Sapphire" js/productsData.js        # Eintrag finden
sed -n '4200,4260p' js/productsData.js              # nur den Ausschnitt lesen
grep -n 'data-tab="batching"' index.html            # Markup-Stelle finden
grep -c "name:" js/productsData.js                  # zählen statt lesen
```

Weitere Regeln für mich (Claude):
- **Immer erst die Architektur-Map oben lesen, dann gezielt greppen** – keine
  breiten Suchläufe über das ganze Repo.
- **Ein Auftrag = ein Modul.** Wenn ein Prompt mehrere Features enthält, arbeite
  ich sie einzeln nacheinander ab und melde nach jedem Teilstück kurz zurück,
  statt alles auf einmal zu laden.
- **Keine Subagenten / keine parallelen Explorationen**, außer der Nutzer bittet
  ausdrücklich darum.
- **Nicht neu lesen, was ich in dieser Session schon gelesen habe.**
- Nach Edits nicht zur Kontrolle nochmal die ganze Datei lesen.
- Massen-Datenänderungen (viele Rezepte/Produkte) über ein kleines Skript oder
  SQL, nicht über hunderte Einzel-Edits.

### Wann ich ein neues Fenster empfehle

Ich sage von mir aus Bescheid, wenn eine dieser Bedingungen zutrifft:
- Die aktuelle Aufgabe ist abgeschlossen und committet, und der nächste Auftrag
  betrifft ein **anderes Modul / anderes Thema**.
- Wir haben in dieser Session bereits eine der großen Datendateien angefasst.
- Es wurde in dieser Session schon einmal komprimiert, oder es wurde mehr als
  eine der großen Datendateien angefasst.
- Es kommt eine Aufgabe, die viel neuen Kontext braucht (Datenimport,
  Schema-Umbau, Redesign).

Die Empfehlung sieht immer so aus – **kurz und mit fertigem Startprompt**:

> **Empfehlung: neues Fenster.** Grund: <ein Satz>.
> Stand: <was ist fertig + Commit-Hash>.
> Modell: <Modell + Denkaufwand + ein Halbsatz Begründung>.
> Startprompt fürs neue Fenster:
> ```
> <vollständiger, selbsterklärender Prompt inkl. betroffener Dateien,
>  Ziel und relevanter Vorentscheidungen – ohne Rückverweis auf diesen Chat>
> ```

Der Startprompt muss allein stehen können: betroffene Dateien mit Pfad, Ziel,
bereits getroffene Entscheidungen, was ausdrücklich **nicht** angefasst werden soll.

### Modellempfehlung – Raster

Die Zeile „Modell" gehört zu **jeder** Fenster-Empfehlung und zu **jedem**
Startprompt, den ich ausgebe – auch außerhalb der Pakete aus dem Ausbauplan.
Wo `docs/AUSBAUPLAN.md` in der Spalte „Modell" schon etwas vorgibt, gilt das;
sonst als Faustregel nach Art der Aufgabe, nicht nach Paketnummer:

| Art der Aufgabe | Modell | Denkaufwand |
|---|---|---|
| Schema-/RLS-Umbau, neue Datenart, mehrere Module gleichzeitig, Datenimport, Redesign | Opus 5 | hoch |
| Ein Modul nach vorhandenem Muster, liest überwiegend vorhandene Daten, Auswertungs-/Anzeigeseiten | Sonnet 5 | mittel |
| Textausbau vieler Produkte nach festem Raster (Massenänderung per Skript/SQL) | Sonnet 5 | niedrig |
| Kleinkram: Tippfehler, CSS-Detail, eine einzelne Funktion, Cache-Bump | Haiku 4.5 | niedrig |

Bei Grenzfällen das teurere Modell nennen: eine falsche Schema-Migration kostet
mehr als eine Session auf Opus.

## Testaccount (Supabase Auth)
Für Login-/Feature-Tests existiert ein Admin-Testaccount in der Supabase-
Instanz (Projekt `hwahjjihajgajcnzngwv`). Nicht in Produktionslisten/Bestellungen
verwenden, nur zum Durchklicken des Tools.

- Benutzername: `claude-test`
- E-Mail: `claude-testaccount@bartool.local`
- Rolle: `admin`
- Passwort: liegt **nicht** hier (Repo ist public), sondern lokal in
  `.claude/local/testaccount.md` (per `.gitignore` von Commits ausgeschlossen).
  Fehlt diese Datei in einer neuen Session: Passwort per `execute_sql` neu
  setzen mit
  `update auth.users set encrypted_password = crypt('<neues_pw>', gen_salt('bf')), updated_at = now() where email = 'claude-testaccount@bartool.local';`
  und lokal in `.claude/local/testaccount.md` ablegen (nicht committen).

## Git
- Entwicklung und Push auf `main`.
- Commit-Messages auf Deutsch: kurzer Titel, bei Bedarf 1–2 Zeilen Kontext.
- Automatisch committen, wenn ein Arbeitsschritt fertig und lauffähig ist.

## Nicht in dieser Datei
Persönliche Kommunikations-/Arbeitspräferenzen stehen in den globalen
Claude-Einstellungen und werden hier bewusst nicht dupliziert.
