# Bartool – Ausbauplan (Arbeitsauftrag)

Diese Datei ist ein **Arbeitsauftrag zum Abarbeiten in genau dieser Reihenfolge**.
Sie ist so geschrieben, dass sie ohne den Chat funktioniert, in dem sie entstanden ist.

---

## 0. Spielregeln (vor dem ersten Paket lesen, danach nie wieder)

**Ablauf pro Paket**
1. Nur **ein Paket pro Fenster/Session**. Nie zwei Pakete gleichzeitig anfangen.
2. Reihenfolge einhalten. Pakete bauen aufeinander auf; die Abhängigkeit steht bei jedem Paket.
3. Vor dem Start: nur die unter „Dateien" genannten Stellen lesen – **gezielt per `grep -n` / `sed -n`**, nie ganze Datei.
4. Abnahme-Checkliste komplett abarbeiten, dann committen, dann kurze Rückmeldung an den Nutzer, dann **Ende der Session**.
5. Am Ende jedes Pakets in dieser Datei die Fortschrittstabelle auf `erledigt` setzen und mitcommitten.

**Kontext-Budget (hier wird Geld verbrannt)**
- `js/productsData.js` (~140 KB), `js/classicsData.js` (~130 KB), `index.html` (~38 KB) **niemals ganz lesen.**
- Immer: `grep -n "suchbegriff" datei` → Zeilennummer → `sed -n '120,160p' datei`.
- `js/products.js` (~28 KB) und `js/recipes.js` (~18 KB) nur abschnittsweise.
- Nach einem Edit **nicht** zur Kontrolle die Datei nochmal lesen.
- Keine Subagenten, keine breiten Repo-Suchen, keine „Exploration".
- Nicht neu lesen, was in derselben Session schon gelesen wurde.

**Harte Projekt-Regeln (gelten in jedem Paket)**
- Kein Build-Schritt, keine Frameworks, keine npm-Abhängigkeit im Frontend. Externe Libs nur per CDN-`<script>`.
- Muster für neue Features: **ein Modul `js/xyz.js` mit `initXyz()`** + Import und Aufruf in `js/main.js`
  + `<button class="tab-btn" data-tab="xyz">` + `<section id="xyz" class="tab-panel">` in `index.html`.
  Dieses Muster nie durchbrechen.
- Daten nur über `getAllRecipes()` / `getAllProducts()` lesen, nie direkt aus den Daten-Dateien.
- Nutzereingaben nie als HTML einsetzen: `textContent` oder `escapeHtml()` aus `js/utils.js`. Es gab hier schon einen stored-XSS-Fix.
- Nur `SUPABASE_URL` + anon key im Client. Service-Role-Key oder DB-Passwort niemals in Code oder Commit.
- RLS ist auf allen Tabellen aktiv. Schema-Änderungen **nur** über die Supabase-MCP-Tools (`apply_migration`, project_ref-gescoped),
  danach `supabase/schema.sql` von Hand nachziehen.
- Der Produktkatalog liegt zusätzlich 1:1 in der DB. **Eine Änderung nur in der JS-Datei ist im Live-Tool unsichtbar.**
  Vor inhaltlichen Änderungen an Produkten/Rezepten per `execute_sql` prüfen, ob ein DB-Eintrag mit dem Namen existiert,
  und die DB per `UPDATE ... WHERE name = '...'` mitziehen.
- Zutaten↔Produkt-Matching ist ein strikter Teilstring-Vergleich:
  `ingredient.name.toLowerCase().includes(product.name.toLowerCase())`.
  Generisch („Gin") matcht nicht, es braucht die Hausmarke („Bombay Sapphire Gin").
  Produktnamen vor dem Schreiben per `grep -n` verifizieren, nie aus dem Kopf tippen.
- Kein Commit auf einem nicht lauffähigen Stand. Vorher `python3 -m http.server 8000` und die betroffenen Tabs durchklicken.
- Commit-Messages auf Deutsch: kurzer Titel, bei Bedarf 1–2 Zeilen Kontext. Entwicklung und Push auf `main`.

**Wann anhalten und den Nutzer fragen (nicht raten, nicht erfinden)**
- Produktdaten, Dichten, Haltbarkeiten, Preise, Allergene: **niemals schätzen oder erfinden.** Nur was in den echten
  Listen steht oder was der Nutzer bestätigt hat.
- Dark Theme und Layout-Grundgerüst nicht ohne Rückfrage ändern.
- Wenn ein Paket eine Entscheidung braucht, die hier nicht steht: fragen, gebündelt, mit Default-Vorschlag.

**Nützliche Fakten (bereits verifiziert, nicht nachrecherchieren)**
- Deployment: GitHub Pages unter einem **Unterverzeichnis** (`https://<user>.github.io/Bartool/`).
  → Alle Pfade **relativ** (`js/main.js`, `./sw.js`), niemals mit führendem `/`.
- CDN-Libs in `index.html`: `xlsx 0.18.5` (cdnjs) und `@supabase/supabase-js@2` (jsdelivr).
- `products.abv` ist **Text**, Format u. a. `"40 % vol"`, `"43,1 % vol"`, `"42 % vol (bitte gegen Flasche prüfen)"`.
  → Immer robust parsen: erste Zahl, Komma zu Punkt, sonst „unbekannt".
- `products.allergens` ist Text, häufig `"Keine bekannten"`.
- `products.price_value` ist `numeric`, `products.price_unit` ist Text (`"liter"` oder Stück).
- Vorhandene Exports, die wiederverwendet werden:
  - `js/tabs.js`: `switchTab(tabId, opts)`, `closeMobileNav()`, `setPendingEditReturn()`, `takePendingEditReturn()`
  - `js/recipes.js`: `openRecipeForEdit(name)` – öffnet die **Bearbeiten**-Ansicht (nur Admin sinnvoll)
  - `js/products.js`: `openProductForEdit(name)` – dito
  - `js/auth.js`: `isAdmin()`, `getCurrentUser()`, `getCurrentProfile()`
  - `js/storage.js`: `loadRecipes/saveRecipe/deleteRecipe/onRecipesChanged/initRecipeSync` und dasselbe Muster für Produkte
  - `js/utils.js`: `escapeHtml()`, `formatNumber()`
  - `js/units.js`: `UNIT_TO_ML`, `UNIT_LABELS`
  - `js/costing.js`: `ingredientCost()`, `priceForIngredient()`, `calculateRecipeCost()`
  - `js/ingredientEditor.js`: `createIngredientEditor(containerEl)`

---

## 1. Fortschritt

| # | Paket | Status |
|---|---|---|
| 1 | PWA installierbar + App-Shell offline | erledigt |
| 2 | Daten-Cache offline + Offline-Banner | erledigt |
| 3 | Druckansicht (`@media print`) | offen |
| 4 | Globale Suche (Cmd/Ctrl+K) | offen |
| 5 | `js/abv.js` – ABV-Mathematik zentralisieren | offen |
| 6 | Bottled-Cocktail-Modus im Batching | offen |
| 7 | Allergene pro Rezept | offen |
| 8 | Kartenkalkulation | offen |
| 9 | Ansätze / Mise en Place | offen |
| 10 | Etiketten drucken | offen |
| 11 | Inventur – Erfassung | offen |
| 12 | Inventur – Auswertung & Bestellvorschlag | offen |
| 13 | Excel-Import für Produkte | offen |
| 14 | Startseite: Favoriten & zuletzt benutzt | offen |
| 15 | Audit-Log: Wiederherstellen | offen |

---

# Paket 1 – PWA installierbar + App-Shell offline

**Abhängigkeit:** keine.
**Ziel:** Bartool lässt sich auf Handy/Tablet zum Homescreen hinzufügen und startet ohne Netz (Oberfläche, nicht Daten).

**Dateien**
- neu: `manifest.json` (Root), `sw.js` (Root), `icons/` (Root)
- geändert: `index.html` (Kopfbereich), `js/main.js` (Registrierung am Dateiende)

**Schritte**
1. `manifest.json` anlegen: `name` „Bartool", `short_name` „Bartool", `start_url: "./"`, `scope: "./"`,
   `display: "standalone"`, `background_color` und `theme_color` = `#0c0c0e` (identisch zum vorhandenen
   `<meta name="theme-color">` in `index.html`, Zeile ~6), `icons` siehe Schritt 2.
2. Icons: `icons/icon-192.png` und `icons/icon-512.png` erzeugen (dunkler Grund `#0c0c0e`, goldenes „B" –
   Goldton aus `css/styles.css` per `grep -n "gold\|--accent" css/styles.css` holen).
   Erzeugung einmalig per kleinem Python-Skript mit Pillow ist erlaubt (reines Build-Asset, keine Frontend-Abhängigkeit).
   **Wenn Pillow nicht verfügbar ist: nicht basteln** – Nutzer fragen, ob er ein Logo liefert, und das Paket
   vorerst ohne `icons` im Manifest abschließen (Manifest bleibt gültig, nur die Installations-Aufforderung fehlt).
3. In `index.html` im `<head>` ergänzen: `<link rel="manifest" href="manifest.json">` und `<link rel="apple-touch-icon" href="icons/icon-192.png">`.
4. `sw.js` schreiben:
   - `const CACHE = "bartool-v1";` – **diese Zahl bei jedem späteren Paket hochzählen, das Frontend-Dateien ändert.**
   - `install`: `index.html`, `manifest.json`, `css/styles.css`, alle Dateien aus `js/` (Liste per `ls js/*.js` erzeugen und fest eintragen), die Icons.
   - `activate`: alle Caches löschen, deren Name nicht `CACHE` ist; `clients.claim()`.
   - `fetch`:
     - Requests mit `supabase.co` in der URL: **komplett durchreichen, nie cachen** (`return;` ohne `respondWith`).
     - Nicht-GET: durchreichen.
     - CDN-Requests (cdnjs, jsdelivr): stale-while-revalidate, damit die App offline nicht an fehlendem `xlsx`/`supabase-js` stirbt.
     - Alles andere: cache-first mit Netz-Fallback.
5. In `js/main.js` ganz unten registrieren, defensiv:
   ```js
   if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
     window.addEventListener("load", () => navigator.serviceWorker.register("sw.js", { scope: "./" }).catch(() => {}));
   }
   ```

**Abnahme**
- [ ] `python3 -m http.server 8000`, Seite laden, DevTools → Application → Service Worker: „activated".
- [ ] Netz in DevTools auf „Offline", Reload: Login-Screen bzw. App-Shell erscheint (Daten dürfen fehlen).
- [ ] Netz wieder an, Reload: Login und alle Tabs funktionieren wie vorher.
- [ ] Kein Supabase-Request im Cache-Storage.

**Commit:** `PWA: Manifest, Icons und Service Worker für Offline-Shell`

---

# Paket 2 – Daten-Cache offline + Offline-Banner

**Abhängigkeit:** Paket 1.
**Ziel:** Rezepte, Produkte und alle Rechner funktionieren ohne Netz. Schreiben wird sauber abgewiesen statt still zu scheitern.

**Problem heute:** `recipesCache` / `productsCache` in `js/storage.js` liegen nur im RAM; jeder Reload braucht Netz.

**Dateien**
- geändert: `js/storage.js`, `js/main.js`, `index.html` (ein Banner-Element), `css/styles.css` (Banner-Stil)
- `sw.js`: `CACHE`-Version hochzählen

**Schritte**
1. In `js/storage.js` zwei kleine Helfer ergänzen (nicht exportieren):
   `readCache(key)` und `writeCache(key, data)` auf `localStorage`, beide komplett in `try/catch`
   (Quota/Private-Mode dürfen die App nie kippen). Keys: `bartool:recipes`, `bartool:products`.
2. `refreshRecipes()` / `refreshProducts()`: bei Erfolg zusätzlich in den Cache schreiben.
   Bei Fehler (`error` gesetzt): den persistierten Cache laden, statt den leeren RAM-Cache stehen zu lassen.
3. `initRecipeSync()` / `initProductSync()`: **vor** dem Netz-Request den persistierten Cache in die Variable legen
   und das `*-updated`-Event feuern → die App rendert sofort, das Netz aktualisiert danach.
4. `saveRecipe/deleteRecipe/saveProduct/deleteProduct`: wenn `!navigator.onLine`, sofort mit einer klaren
   Fehlermeldung abbrechen („Offline – Änderungen sind erst wieder mit Netz möglich."). **Keine Offline-Warteschlange bauen** – bewusst außerhalb des Scopes.
5. Offline-Banner: ein `<div id="offline-banner" hidden>` direkt unter dem Header in `index.html`,
   in `js/main.js` an `online`/`offline`-Events hängen, Text „Offline – nur Lesen und Rechnen möglich."
   Stil im vorhandenen Dark-Theme, Farbvariablen aus `css/styles.css` wiederverwenden, keine neuen Farben erfinden.

**Abnahme**
- [ ] Online laden, dann offline + Reload: Rezepte- und Produkte-Tab zeigen die Einträge, Suche funktioniert.
- [ ] Alle fünf Rechner rechnen offline.
- [ ] Offline auf „Speichern": verständliche Fehlermeldung, kein stiller Datenverlust.
- [ ] Banner erscheint/verschwindet beim Umschalten der Netzverbindung.
- [ ] Wieder online: Realtime-Sync aktualisiert weiter (Eintrag in einem zweiten Tab ändern und prüfen).

**Commit:** `Offline-Betrieb: Rezepte und Produkte lokal puffern, Schreibzugriff offline blockieren`

---

# Paket 3 – Druckansicht

**Abhängigkeit:** keine (kann auch vor 1 gemacht werden).
**Ziel:** Rezept, Batch-Ergebnis und Kalkulation sauber auf Papier. Grundlage für die Etiketten in Paket 10.

**Dateien:** nur `css/styles.css` (neuer Block am Dateiende), ggf. `index.html` für `class="no-print"`.

**Schritte**
1. Am Ende von `css/styles.css` einen Block `@media print { ... }` anlegen (existiert bisher gar nicht).
2. Ausblenden: Header, Sidebar/Navigation, Tab-Leiste, alle Buttons, Suchfelder, Filter, Offline-Banner.
   Dafür `.no-print` als Sammelklasse einführen und in `index.html` an den betroffenen Containern ergänzen.
3. Nur das aktive `.tab-panel` drucken.
4. Lesbar machen: Hintergrund weiß, Schrift schwarz, `box-shadow: none`, Tabellen mit dünnen Linien,
   `page-break-inside: avoid` für Rezept-/Ergebnisblöcke.
5. Das Bildschirm-Theme dabei **nicht** anfassen.

**Abnahme**
- [ ] Druckvorschau in Rezepte (aufgeklapptes Rezept), Batching (mit Ergebnis) und Kalkulation: lesbar, ohne Navigation, keine abgeschnittenen Tabellen.
- [ ] Bildschirmdarstellung unverändert.

**Commit:** `Druckansicht für Rezepte, Batching und Kalkulation`

---

# Paket 4 – Globale Suche (Cmd/Ctrl+K)

**Abhängigkeit:** keine.
**Ziel:** Ein Overlay, das Rezepte und Produkte gemeinsam durchsucht und direkt zum Eintrag springt. Heute gibt es Suche nur getrennt pro Tab.

**Dateien**
- neu: `js/quickSearch.js`
- geändert: `js/main.js` (Import + `initQuickSearch()`), `index.html` (Overlay-Markup + Header-Button),
  `css/styles.css`, `js/recipes.js` und `js/products.js` (je eine neue Export-Funktion)

**Schritte**
1. In `js/recipes.js` `focusRecipe(name)` exportieren: Listenansicht anzeigen, Kategoriefilter zurücksetzen,
   Suchfeld auf den Namen setzen, Liste neu rendern, Eintrag aufklappen und `scrollIntoView`.
   Vorhandene interne Funktionen wiederverwenden (`showListView`, `resetCategoryFilter`, `renderBrowseList`) – nichts duplizieren.
   **Nicht** `openRecipeForEdit` verwenden: das ist die Bearbeiten-Ansicht und für Mitarbeiter falsch.
2. Analog in `js/products.js` `focusProduct(name)` (`showListView`, `resetCategoryFilters`, `renderBrowseList`).
3. `js/quickSearch.js`: Overlay öffnen per `Cmd/Ctrl+K` und per Lupen-Button im Header, schließen per `Esc` und Klick auf den Hintergrund.
   Sucht case-insensitiv in Name und Kategorie über `getAllRecipes()` + `getAllProducts()`,
   zeigt maximal 8 Treffer je Gruppe, Gruppen beschriftet mit „Rezepte" / „Produkte".
   Tastatur: Pfeile hoch/runter, Enter wählt. Klick/Enter → `switchTab("recipes"|"products")` + `focusRecipe/focusProduct`, danach Overlay schließen.
   Alle Treffer über `escapeHtml()` ausgeben.
4. Touch beachten: Trefferzeilen mindestens 44 px hoch, das Overlay muss auf dem Handy die volle Breite nutzen.

**Abnahme**
- [ ] Cmd/Ctrl+K öffnet, Esc schließt, Header-Button funktioniert auf dem Handy.
- [ ] Treffer aus beiden Bibliotheken; Sprung öffnet den richtigen Eintrag im richtigen Tab.
- [ ] Ein Rezeptname mit `<`/`&` bricht nichts.
- [ ] Als Nicht-Admin (Rolle Mitarbeiter) landet der Sprung in der Leseansicht, nicht im Formular.

**Commit:** `Globale Suche über Rezepte und Produkte per Cmd/Ctrl+K`

---

# Paket 5 – `js/abv.js`: ABV-Mathematik zentralisieren

**Abhängigkeit:** keine. **Reines Refactoring, keine sichtbare Änderung.**
**Ziel:** Die Alkohol-Rechnung liegt einmal zentral, damit Paket 6 darauf aufsetzen kann.

**Dateien**
- neu: `js/abv.js`
- geändert: `js/dilution.js`

**Schritte**
1. `js/abv.js` mit vier reinen Funktionen (keine DOM-Zugriffe, keine Seiteneffekte):
   - `parseAbv(text)` → Zahl oder `null`. Muss `"40 % vol"`, `"43,1 % vol"`, `"42 % vol (bitte gegen Flasche prüfen)"` und `""` verkraften: erste Zahl im String, Komma zu Punkt.
   - `alcoholMl(items)` mit `items = [{ amountMl, abv }]` → Summe reiner Alkohol in ml.
   - `abvAfterWater(alcoholMl, volumeMl, waterMl)` → `alcoholMl / (volumeMl + waterMl) * 100`, bei Nenner 0 → 0.
   - `waterForTargetAbv(alcoholMl, volumeMl, targetAbv)` → `alcoholMl / targetAbv * 100 - volumeMl`, negativ → `0` (Ziel-ABV bereits unterschritten).
2. `js/dilution.js` auf diese Funktionen umstellen. Sichtbares Verhalten und Rundungen müssen **exakt gleich** bleiben.

**Abnahme**
- [ ] Verdünnung/ABV-Tab liefert für dieselben Eingaben dieselben Zahlen wie vorher (vorher/nachher mit zwei Beispielen vergleichen).
- [ ] Keine Änderung an `index.html` oder `css/styles.css` nötig gewesen.

**Commit:** `ABV-Berechnung in js/abv.js zentralisiert`

---

# Paket 6 – Bottled-Cocktail-Modus im Batching

**Abhängigkeit:** Paket 5.
**Ziel:** Der eigentliche Anwendungsfall hinterm Tresen: vorgebatchte Flaschen mit Dilution-Zuschlag und Ziel-ABV.
**Kein neuer Tab** – dritter Modus im vorhandenen Batching-Tab.

**Dateien**
- geändert: `js/batching.js`, `index.html` (Batching-Panel, per `grep -n 'id="batching"' index.html` finden), `css/styles.css` bei Bedarf

**Schritte**
1. Zum vorhandenen Radio `name="batch-mode"` (Werte `portions`, `volume`) einen dritten Wert `bottles` ergänzen.
   Die vorhandene Mechanik `[data-mode-field]` in `js/batching.js` trägt das bereits – nur die neuen Felder mit `data-mode-field="bottles"` auszeichnen.
2. Neue Eingaben im Bottles-Modus: Flaschengröße in ml (Standard 700), Anzahl Flaschen,
   und eine Umschaltung „Verdünnung in %" **oder** „Ziel-ABV in %".
3. ABV je Zutat automatisch bestimmen: `getProduct(zutatenname)?.abv` → `parseAbv()`.
   Matching-Regel beachten (strikter Teilstring, Hausmarke). Jede Zutatenzeile bekommt ein **überschreibbares**
   ABV-Feld: vorbelegt aus dem Katalog, bei Fehlschlag leer und sichtbar als „ABV unbekannt" markiert.
   Niemals stillschweigend mit 0 rechnen.
4. Rechnung über `js/abv.js`. Ausgabe unter der Zutatentabelle:
   Gesamtvolumen unverdünnt · Wasserzugabe in ml · Gesamtvolumen final · End-ABV in % ·
   Füllmenge je Flasche · Anzahl voller Flaschen · Rest in ml.
5. Live-Rechnung: die vorhandenen `input`/`change`-Listener auf `panelEl` decken das ab, nichts Neues erfinden.
6. Der vorhandene Teilen-Button (`shareResult`) muss die Bottled-Werte mit ausgeben.

**Abnahme**
- [ ] Modi „Portionen" und „Volumen" verhalten sich unverändert.
- [ ] Rezept laden (z. B. ein Negroni-artiger Drink), Bottles-Modus, 10 Flaschen à 700 ml, 20 % Dilution → plausible Wasserzugabe und End-ABV.
- [ ] Umschalten auf Ziel-ABV 24 % → passende Wassermenge, End-ABV trifft das Ziel.
- [ ] Zutat ohne Katalog-Treffer („Zuckersirup 1:1") wird als ABV unbekannt markiert und ist manuell setzbar.
- [ ] Ziel-ABV höher als der unverdünnte ABV → Wasserzugabe 0 und ein Hinweis statt einer negativen Zahl.

**Commit:** `Batching: Bottled-Cocktail-Modus mit Dilution und Ziel-ABV`

---

# Paket 7 – Allergene pro Rezept

**Abhängigkeit:** keine.
**Ziel:** Allergene liegen je Produkt vor, werden aber nirgends auf den Drink hochgerechnet. LMIV-relevant.

**Dateien**
- neu: `js/allergens.js`
- geändert: `js/recipes.js` (Detailansicht eines Rezepts, `renderRecipeItem` ab ca. Zeile 258)

**Schritte**
1. `js/allergens.js`: `allergensForRecipe(recipe)` → `{ allergens: string[], unmatched: string[] }`.
   Je Zutat das Produkt über dieselbe Matching-Regel suchen, `allergens`-Text einsammeln,
   Einträge wie `"Keine bekannten"` herausfiltern, Duplikate entfernen.
   Zutaten ohne Produkt-Treffer landen in `unmatched`.
2. In der Rezept-Detailansicht eine Zeile „Allergene" ergänzen:
   gefundene Allergene, und falls `unmatched` nicht leer ist, ein deutlicher Zusatz
   „ungeprüft: <Zutaten>". **Keine Aussage „allergenfrei" erzeugen** – Lücke zeigen ist besser als falsche Sicherheit.
3. Ausgabe über `escapeHtml()`.

**Abnahme**
- [ ] Ein Rezept mit Sahne-/Ei-/Nuss-Komponente zeigt die Allergene des jeweiligen Produkts.
- [ ] Ein Rezept mit frei getippter Zutat zeigt diese unter „ungeprüft".
- [ ] Kein Rezept zeigt jemals „keine Allergene" ohne den Prüfhinweis.

**Commit:** `Allergene je Rezept aus dem Produktkatalog ableiten`

---

# Paket 8 – Kartenkalkulation

**Abhängigkeit:** Paket 3 (Druck) empfohlen, sonst keine.
**Ziel:** Nicht ein Drink, sondern eine ganze Karte durchrechnen: Wareneinsatz, Zielpreis, Deckungsbeitrag, Pour Cost.

**Dateien**
- neu: `js/menuCosting.js`
- geändert: `js/main.js`, `index.html` (neuer Tab-Button + Panel), `js/storage.js` (Feld `salesPrice`), `supabase/schema.sql`
- Migration: Spalte `sales_price numeric` an `public.recipes`

**Schritte**
1. Migration per Supabase-MCP `apply_migration`: `alter table public.recipes add column if not exists sales_price numeric;`
   Danach `supabase/schema.sql` von Hand nachziehen. RLS-Policies bleiben unverändert (die Tabelle hat schon welche).
2. `js/storage.js`: `sales_price` in `toRecipeRecord`/`fromRecipeRow` als `salesPrice` ergänzen.
   `js/recipes.js`: Eingabefeld „Verkaufspreis (€)" im Rezeptformular (nur Admin sichtbar, wie die anderen Bearbeitungsfelder).
3. `js/menuCosting.js` + Tab „Karte": Mehrfachauswahl von Rezepten (Checkbox-Liste mit Suchfeld),
   pro Zeile via `calculateRecipeCost()` aus `js/costing.js`:
   Wareneinsatz · Verkaufspreis · Deckungsbeitrag · Pour Cost in % · Zielpreis bei eingestellter Zielquote (Standardwert 20 %) inkl. MwSt.-Schalter wie im Kalkulations-Tab.
   Summenzeile unten. Zeilen mit unbekannten Preisen (`allPricesKnown === false`) sichtbar markieren, nicht schönrechnen.
4. Export-Button „Excel" analog zu `js/recipeExport.js` (das Muster kopieren, nicht neu erfinden).

**Abnahme**
- [ ] Verkaufspreis lässt sich am Rezept speichern und ist nach Reload da.
- [ ] Karte mit 5 Rezepten zeigt korrekte Summen; ein Rezept mit fehlendem Zutatenpreis ist als unvollständig markiert.
- [ ] Excel-Export öffnet sich mit den richtigen Spalten.
- [ ] Nicht-Admin sieht die Karte, kann aber keine Preise ändern.

**Commit:** `Kartenkalkulation: Wareneinsatz, Deckungsbeitrag und Pour Cost über mehrere Rezepte`

---

# Paket 9 – Ansätze / Mise en Place

**Abhängigkeit:** Paket 6 (die Batch-Werte kommen von dort).
**Ziel:** Was ist angesetzt, wie lange hält es, was muss heute nachgezogen werden.

**⚠️ Vor dem Start den Nutzer fragen** (gebündelt, mit Default-Vorschlag) und die Antworten fest eintragen:
Standard-Haltbarkeit in Tagen je Typ – Superjuice, Zuckersirup, alkoholischer Batch, sonstiges.
**Diese Werte nicht selbst erfinden.**

**Dateien**
- neu: `js/preparations.js`
- geändert: `js/main.js`, `index.html` (Tab + Panel), `js/batching.js` (Button „Als Ansatz speichern"), `supabase/schema.sql`

**Schema (per `apply_migration`)**
```sql
create table if not exists public.preparations (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  recipe_name text,
  prep_type text,                 -- superjuice | sirup | batch | sonstiges
  batch_size_ml numeric,
  abv numeric,
  made_at timestamptz not null default now(),
  made_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz,
  status text not null default 'aktiv',   -- aktiv | verbraucht
  notes text,
  updated_at timestamptz not null default now()
);
alter table public.preparations enable row level security;
```
Policies nach dem Muster von `public.recipes` in `supabase/schema.sql`:
lesen für alle authentifizierten Nutzer; anlegen und ändern für alle authentifizierten Nutzer
(Ansätze macht das ganze Team, nicht nur Admins); löschen nur Admin über `private.is_admin()`.
Trigger `set_updated_at` anhängen wie bei den anderen Tabellen. Danach `supabase/schema.sql` nachziehen.

**Schritte**
1. `js/storage.js` um den vollständigen Satz erweitern, exakt nach dem vorhandenen Muster:
   `initPreparationSync()`, `loadPreparations()`, `savePreparation()`, `deletePreparation()`, `onPreparationsChanged()`
   inklusive Realtime-Channel. Kein abweichendes Muster erfinden.
2. `js/preparations.js` + Tab „Mise en Place": drei Gruppen – „läuft ab (≤ 2 Tage)", „aktiv", „abgelaufen".
   Je Eintrag: Label, Menge, ABV, angesetzt am, haltbar bis, Ersteller, Status.
   Aktionen: „verbraucht" markieren, löschen (nur Admin), neuer Ansatz von Hand.
3. In `js/batching.js` im Ergebnisblock einen Button „Als Ansatz speichern":
   übernimmt Name, Gesamtvolumen und – im Bottles-Modus – den End-ABV, setzt `expires_at`
   aus der in der Rückfrage geklärten Standard-Haltbarkeit, Datum im Dialog änderbar.
4. Sortierung immer nach `expires_at` aufsteigend. Datumsformat `de-DE`.

**Abnahme**
- [ ] Batch rechnen → „Als Ansatz speichern" → Eintrag erscheint sofort im Mise-en-Place-Tab.
- [ ] Ein Ansatz mit Ablauf morgen steht in der Warngruppe, einer mit Ablauf gestern in „abgelaufen".
- [ ] Zweiter Browser/Tab sieht neue Ansätze per Realtime ohne Reload.
- [ ] Mitarbeiter (kein Admin) kann anlegen und auf „verbraucht" setzen, aber nicht löschen.

**Commit:** `Mise en Place: Ansätze mit Haltbarkeit erfassen und überwachen`

---

# Paket 10 – Etiketten drucken

**Abhängigkeit:** Pakete 3 und 9.
**Ziel:** Flaschenetikett für einen Ansatz.

**Dateien:** geändert: `js/preparations.js`, `css/styles.css` (Print-Block aus Paket 3 erweitern), `index.html` (Etiketten-Container)

**Schritte**
1. Button „Etikett" je Ansatz öffnet eine Etikettenansicht:
   Name · Ansatzdatum · haltbar bis · ABV · Ersteller · optional Notiz.
2. Druckformat: Bogen mit mehreren Etiketten auf DIN A4, feste Etikettengröße per `mm`-Einheiten,
   `page-break-inside: avoid` je Etikett. Kein Label-Drucker-Treiber, kein externes Layout-Framework.
3. Optional (nur wenn ohne zusätzliche Abhängigkeit machbar): QR-Code auf den Rezept-Deeplink.
   Das URL-Hash-Routing ist in `js/tabs.js` bereits vorhanden. **Wenn dafür eine Library nötig wäre: weglassen** und dem Nutzer sagen, dass es fehlt.

**Abnahme**
- [ ] Druckvorschau zeigt saubere Etiketten ohne Navigationselemente.
- [ ] Schrift auch bei langen Namen lesbar, kein Überlaufen.
- [ ] Mehrere Etiketten passen ohne Zerschneiden auf eine Seite.

**Commit:** `Etiketten für Ansätze drucken`

---

# Paket 11 – Inventur: Erfassung

**Abhängigkeit:** Paket 2 (offline-fähig, im Lager ist selten WLAN).
**Ziel:** Bestände mobil zählen, ohne dass ein Verbindungsabbruch die Zählung zerstört.

**Dateien**
- neu: `js/inventory.js`
- geändert: `js/main.js`, `index.html` (Tab + Panel), `js/storage.js`, `supabase/schema.sql`

**Schema (per `apply_migration`)**
```sql
create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  counted_on date not null default current_date,
  status text not null default 'offen',      -- offen | abgeschlossen
  created_by uuid references public.profiles (id) on delete set null,
  note text,
  updated_at timestamptz not null default now()
);
create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.inventory_counts (id) on delete cascade,
  product_name text not null,
  quantity numeric,
  unit text,
  unique (count_id, product_name)
);
alter table public.inventory_counts enable row level security;
alter table public.inventory_items enable row level security;
```
Policies: lesen und schreiben für alle authentifizierten Nutzer, löschen nur Admin.
`product_name` statt `product_id`, damit es zum vorhandenen namensbasierten Matching passt.
Danach `supabase/schema.sql` nachziehen.

**Schritte**
1. `js/storage.js` um das Sync-Muster für beide Tabellen erweitern (wie in Paket 9).
2. Zähl-Ansicht, **mobil zuerst**: Produkte nach Kategorie gruppiert (Kategoriebaum-Logik aus `js/products.js` wiederverwenden),
   je Zeile ein großes Zahlenfeld plus `−`/`+`-Buttons, Touch-Targets mindestens 44 px, Suchfeld oben.
3. Zwischenstand nach **jeder** Eingabe in `localStorage` puffern (`bartool:inventory-draft:<count_id>`),
   Upload gebündelt beim Speichern bzw. automatisch, sobald wieder online. Ein Verbindungsabbruch darf nie eine Zählung kosten.
4. Fortschrittsanzeige „x von y Produkten gezählt". Nicht gezählte Produkte bleiben `null`, **nicht** 0
   (Unterschied „nicht gezählt" zu „nicht vorhanden" muss erhalten bleiben).
5. „Zählung abschließen" setzt `status = 'abgeschlossen'`; danach ist sie schreibgeschützt (Admin darf wieder öffnen).

**Abnahme**
- [ ] Neue Zählung anlegen, 10 Produkte zählen, Seite neu laden: Werte sind noch da.
- [ ] Offline weiterzählen, wieder online: Werte landen in der DB.
- [ ] Auf dem Handy im Hochformat bedienbar, ohne Zoom.
- [ ] Abgeschlossene Zählung ist nicht mehr editierbar.

**Commit:** `Inventur: mobile Bestandserfassung mit Offline-Puffer`

---

# Paket 12 – Inventur: Auswertung & Bestellvorschlag

**Abhängigkeit:** Paket 11.
**Ziel:** Aus der Zählung wird Bestandswert, Differenz und eine Bestellliste je Lieferant.

**Dateien**
- neu: `js/ordering.js`
- geändert: `js/inventory.js`, `js/products.js` (drei neue Felder), `js/storage.js`, `index.html`, `supabase/schema.sql`

**Migration**
```sql
alter table public.products add column if not exists par_level numeric;
alter table public.products add column if not exists supplier text;
alter table public.products add column if not exists order_unit text;
```
Danach `supabase/schema.sql` nachziehen und die drei Felder in `toProductRecord`/`fromProductRow`
(`js/storage.js`) sowie im Produktformular (`js/products.js`, nur Admin) ergänzen.

**Schritte**
1. Auswertung in `js/inventory.js`: Bestandswert je Produkt über `price_value`/`price_unit`
   (Einheitenlogik aus `js/costing.js` wiederverwenden), Summe je Kategorie und gesamt,
   Differenz zur vorherigen abgeschlossenen Zählung. Excel-Export nach dem Muster von `js/productExport.js`.
2. `js/ordering.js`: Bestellvorschlag = `par_level − gezählte Menge`, nur positive Werte,
   gruppiert nach `supplier`, Menge in `order_unit`. Produkte ohne `par_level` erscheinen in einer eigenen
   Gruppe „Par-Level fehlt" – **nicht** überspringen und **nicht** schätzen.
3. Mengen im Vorschlag müssen vor dem Export von Hand korrigierbar sein.
4. Export je Lieferant nach Excel und Word (beide Muster liegen in `js/productExport.js`).

**Abnahme**
- [ ] Bestandswert einer Testzählung stimmt gegen zwei von Hand nachgerechnete Positionen.
- [ ] Differenz zur Vorzählung wird korrekt angezeigt.
- [ ] Bestellliste gruppiert nach Lieferant, Produkte ohne Par-Level sichtbar ausgewiesen.
- [ ] Export öffnet sich sauber.

**Commit:** `Inventur-Auswertung und Bestellvorschlag je Lieferant`

---

# Paket 13 – Excel-Import für Produkte

**Abhängigkeit:** keine.
**Ziel:** Gegenstück zum vorhandenen Export. `xlsx` ist bereits per CDN geladen.

**Dateien:** neu `js/productImport.js`; geändert `js/products.js` (Button, nur Admin), `index.html`

**Schritte**
1. Datei per `<input type="file">` einlesen, mit `XLSX.read` parsen. Spaltenüberschriften müssen exakt zum
   Export aus `js/productExport.js` passen – die Spaltenliste dort per `grep -n` holen und wiederverwenden.
2. **Pflicht: Diff-Vorschau vor jedem Schreibvorgang.** Drei Gruppen: neu · geändert (mit Feld für Feld alt→neu) · unverändert.
   Erst nach ausdrücklicher Bestätigung schreiben.
3. Schreiben ausschließlich über `saveProduct()` aus `js/storage.js`, damit Audit-Log und Realtime greifen.
   Kein direktes `supabase.from("products")` im Importmodul.
4. Nur für Admins sichtbar (`isAdmin()` und `data-admin-only` wie bei den anderen Admin-Elementen).
5. Fehlerhafte Zeilen sammeln und am Ende anzeigen, statt den ganzen Import abzubrechen.

**Abnahme**
- [ ] Export → Datei ohne Änderung reimportieren → Vorschau zeigt „unverändert" für alle Zeilen.
- [ ] Ein Feld in der Datei ändern → nur diese eine Zeile erscheint als „geändert".
- [ ] Datei mit unbekannter Spalte → verständliche Fehlermeldung, kein Schreibvorgang.
- [ ] Nicht-Admin sieht den Button nicht.

**Commit:** `Produkte aus Excel importieren mit Diff-Vorschau`

---

# Paket 14 – Startseite: Favoriten & zuletzt benutzt

**Abhängigkeit:** keine.
**Ziel:** `js/home.js` zeigt heute nur drei Zahlen.

**Dateien:** geändert `js/home.js`, `js/recipes.js`, `js/products.js`, `index.html`, `css/styles.css`

**Schritte**
1. Stern-Button an Rezept- und Produkteinträgen. Favoriten pro Gerät in `localStorage`
   (`bartool:favorites`) – **keine neue Tabelle**, das Tresen-Tablet ist geräte-, nicht personenbezogen.
2. „Zuletzt geöffnet" (maximal 8) ebenfalls in `localStorage` mitschreiben, wenn ein Eintrag aufgeklappt wird.
3. Auf der Startseite zwei Blöcke über den Tool-Kacheln: „Favoriten" und „Zuletzt". Klick springt per
   `focusRecipe`/`focusProduct` (aus Paket 4) direkt zum Eintrag. Leere Blöcke werden ausgeblendet, nicht als leere Kästen angezeigt.

**Abnahme**
- [ ] Favorit setzen/entfernen wirkt sofort und übersteht einen Reload.
- [ ] Startseite zeigt Favoriten und zuletzt geöffnete Einträge, Sprung funktioniert.
- [ ] Ohne Favoriten sieht die Startseite aus wie vorher.

**Commit:** `Startseite: Favoriten und zuletzt geöffnete Einträge`

---

# Paket 15 – Audit-Log: Wiederherstellen

**Abhängigkeit:** keine. Bewusst zuletzt, weil es das kleinste Paket mit dem größten Schadenspotenzial ist.

**Dateien:** geändert `js/auditLog.js`

**Schritte**
1. Prüfen, welche alten Werte `public.audit_log` tatsächlich speichert:
   `sed -n '285,349p' supabase/schema.sql` – nur das lesen, nicht die ganze Datei.
2. Je Eintrag mit vorhandenen Altwerten einen Button „Wiederherstellen", nur für Admins.
3. Vor dem Schreiben ein Bestätigungsdialog mit Feld-für-Feld-Vorschau alt→neu.
4. Zurückschreiben ausschließlich über `saveRecipe()` / `saveProduct()`, damit die Wiederherstellung selbst wieder im Audit-Log landet.
5. Gelöschte Einträge nur wiederherstellen, wenn der Datensatz vollständig im Log liegt – sonst den Button deaktivieren
   und den Grund anzeigen, statt einen halben Datensatz zu schreiben.

**Abnahme**
- [ ] Rezept ändern, im Audit-Log wiederherstellen, alter Stand ist zurück.
- [ ] Die Wiederherstellung erzeugt ihrerseits einen Audit-Eintrag.
- [ ] Bei unvollständigen Logdaten ist der Button deaktiviert samt Begründung.

**Commit:** `Audit-Log: einzelne Änderungen wiederherstellen`

---

## Bewusst nicht im Scope

Nicht bauen, auch wenn es naheliegt – erst nachfragen:
Schulungs-/Quizmodus, Gäste- oder Öffentlichkeitsansicht ohne Login, dritte Rolle für Service/Restaurant,
Offline-Warteschlange für Schreibzugriffe, Batchen nach Gewicht (dafür fehlen belastbare Dichtewerte),
Kassen- oder Warenwirtschaftsanbindung, Frontend-Framework oder Build-Schritt.
