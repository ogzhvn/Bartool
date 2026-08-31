# Bartool – Sitzungszusammenfassung (für Fortsetzung in neuem Chat)

## Projekt
Statische Web-App für eine Bar (Rechner + Bibliothek + Insights), Repo `github.com/ogzhvn/Bartool`, Branch `claude/bartender-tool-webapp-y5ap9q` (= Default-Branch, kein `main`). Reines HTML/CSS/Vanilla-JS ohne Build-Schritt, `localStorage` als einzige Datenhaltung. Ein JS-Modul pro Feature unter `js/`, jeweils mit einer `initX()`-Funktion, importiert in `js/main.js`. GitHub Pages Deployment direkt vom Branch.

## Bisher gebaut (vor dieser Spec-Umsetzung)
- **Rechner-Tabs**: Batching (Rezept-Hochrechner), Superjuice, Zuckersirup, Verdünnung & ABV, Kalkulation.
- **Rezeptbuch**: 50 Klassiker (`classicsData.js`) + 31 echte Hausrezepte der Bar (`houseRecipes.js`), Excel/Word-Export.
- **Produktwissen**: `js/productsData.js` – der komplette, mit dem Barbesitzer sorgfältig abgeglichene Produktkatalog (aktuell 309 Produkte, keine erfundenen Marken). Kategorisiert über `GROUP_ORDER`/`SUBGROUP_ORDER` in `js/products.js` (u. a. Rum nach Herkunftsland sortiert, Scotch Whisky nach Region mit "Single Malt Scotch"-Zwischenüberschrift). Mehrere Korrekturrunden mit dem Nutzer: Marken korrigiert (Boiron/Monin/Giffard-Zuordnung), erfundene Produkte entfernt (Beefeater, Bols Genever, Springbank u. a. – siehe unten), nicht geführte Kategorien komplett gelöscht (Frischware & Kräuter, Bar-Zubehör & Non-Food, Peychaud's Bitters, A-Rosa Sekt).

**Wichtige Lektion aus dieser Phase**: Bei Produktdaten NIE erfinden/schätzen – nur was in den echten Bestelllisten des Nutzers stand oder was er explizit bestätigt hat. Mehrfach musste ich erfundene Produkte auf Nutzerhinweis wieder entfernen.

## FEATURE_SPEC.md – alle 5 Schritte umgesetzt
Datei liegt im Repo-Root (`FEATURE_SPEC.md`), wurde vom Nutzer als fertige Spec übergeben mit der expliziten Anweisung, sie **schrittweise** (Abschnitt 7) umzusetzen und nach jedem Schritt zu testen. Alle 5 Schritte sind fertig, jeder einzeln committet und gepusht, jeweils per Playwright im Browser getestet:

1. **Datenmodell-Erweiterungen** (Commit `9c8c2cd`): `flavorProfile` (8 Aroma-Dimensionen 0-5) an Produkten + Formular-Slider; ~280 bestehende Produkte per Keyword-Heuristik aus `tastingNotes` migriert (grober Startwert, vom Nutzer später korrigierbar). `priceValue`/`priceUnit` an Produkten (bewusst leer gelassen, keine erfundenen Preise). Neues `js/costing.js` (aus `calculation.js` extrahiert: `ingredientCost`, `priceLabelFor`, `calculateRecipeCost`, `priceForIngredient`) – Kalkulations-Tab füllt Preise jetzt automatisch aus dem Produktkatalog vor. `quickPitch`/`pairsWith` an Produkten UND Rezepten mit Formularfeldern + gemeinsamer Autocomplete-Datalist.

2. **Redesign/Navigation** (Commit `ea2a859`): Flache Tab-Leiste ersetzt durch linke Sidebar, gruppiert in **Rechner**/**Bibliothek**/**Insights** (Insights kam in Schritt 3-5 dazu). Klappt unter 700px zu Hamburger-Menü zusammen. `tabs.js`-Mechanismus (`data-tab`/`.tab-panel`) unverändert. Neue CSS-Tokens: `--radius-lg`, `--shadow-card`, `--heat-low`/`--heat-high`.

3. **Aromenmatrix** (Commit `84a3a4b`): Neues `js/compatibility.js` mit `compatibilityScore(productA, productB)` – 70 % Aromaprofil-Kompatibilität über handkuratierte 8×8-Gewichtungstabelle (Kontrast wie süß↔sauer zählt hoch, nicht nur Ähnlichkeit) + 30 % Co-Occurrence-Bonus (gemeinsames Vorkommen in Rezepten). Neuer Tab „Aromenmatrix": Listenmodus (bis zu 3 Zutaten wählen, alle anderen als sortierte Balken, Top 20 mit „mehr anzeigen") + Raster-Modus (auf eine Produktgruppe begrenzt, max. 30 Produkte, vermeidet die 20.000-Zellen-Falle). Klick öffnet Detail-Panel (gemeinsame Aromen, gemeinsame Rezepte, Top-3-Nachbarn).

4. **Verkaufsmatrix** (Commit `a3752fa`): Neuer Tab mit Live/Vorbereitung-Umschalter. **Live** (4 große Touch-Buttons): Gast-Wunsch (Aroma-Chips oder Drink-Name → Top 5 mit Pitch-Zeile), Trade-up (nächsthöhere Produkte gleicher Gruppe/Untergruppe nach Preis), Spickzettel (große Karte, 2-3 Stichpunkte), Cross-Sell (`pairsWith` zuerst, sonst `compatibilityScore()` + andere Kategorie). **Vorbereitung**: vollständige lesbare Liste nach Gruppe/Untergruppe (wiederverwendet `groupProducts`/`GROUP_ORDER` aus `products.js`), komplette Trade-up-Leiter pro Kategorie, Cocktails-Abschnitt, Suche, Drucken-Button mit `@media print`-CSS.

5. **Empfehlungssystem** (Commit `90fb47d`): Neuer Tab „Empfehlungen", nutzt das bestehende `.recipe-edit-layout` Zweispalten-Layout. **Modus A** „Was kann ich aus meinem Bestand machen?": Session-only Checkliste aller Produkte (Standard: alles angehakt, bewusst NICHT persistiert – der Nutzer hatte früher explizit „kein Bestand" gewünscht), Rezepte werden in „Kannst du sofort machen" (100 %) und „Fehlt nur eine Zutat" sortiert. **Modus B** „Ähnlich wie …": Referenzrezept wählen, andere Rezepte gerankt nach Zutaten-Überlappung + paarweise gemitteltem `compatibilityScore()` (neue Hilfsfunktion `resolveIngredientProduct()` in `compatibility.js`). Optionaler Toggle „Margenstarke Vorschläge bevorzugen" nutzt `calculateRecipeCost()`.

Alle Schritte wurden jeweils per Playwright (lokaler `python3 -m http.server` + `playwright-core`, `node_modules` vor jedem Commit wieder gelöscht) durchgeklickt und mit Screenshots visuell geprüft.

## Offener Punkt – DAS ist die nächste Aufgabe
Beim Testen von Schritt 5 aufgefallen: Nur **4 von 81 Rezepten** gelten aktuell als „sofort machbar", weil viele Rezept-Zutatennamen in `classicsData.js` und `houseRecipes.js` noch **generische oder inzwischen umbenannte/entfernte Namen** referenzieren, die nicht mehr zum echten Produktkatalog (`productsData.js`) passen. Die App matcht Zutat↔Produkt überall per Teilstring (`ingredient.name.toLowerCase().includes(product.name.toLowerCase())` – siehe `productLibrary.js:getRecipesUsingProduct`, gleiches Muster in `compatibility.js`, `recommendations.js`, `salesMatrix.js`).

Konkrete Beispiele für den Bruch:
- Generische Klassiker-Zutaten wie „Gin", „Wodka", „Weißer Rum", „Roter Wermut", „Tequila", „Cognac" (die 50 Klassiker wurden geschrieben, bevor der echte Markenkatalog existierte)
- Umbenannte Produkte: „Bombay Gin" → jetzt „Bombay Sapphire Gin", „Vanille-Sirup"/„Grenadine" → jetzt „Giffard Vanille-Sirup"/„Giffard Grenadine", „Ananassaft"/„Apfelsaft" → jetzt „Vaihinger Ananassaft"/„Vaihinger Apfelsaft", „Pfirsich Eistee" → jetzt „Rauch Eistee Pfirsich"
- Entfernte Produkte: „Beery Negroni Sbagliato" (Hausrezept!) referenziert noch „A-Rosa Sekt", das wir auf Nutzerwunsch komplett aus dem Katalog entfernt haben, weil es nicht geführt wird
- Entfernte Frischware: „Limette", „Zitrone", „Minzblätter", „Limettenblätter", „Banane" (ganze Kategorie „Frischware & Kräuter" wurde gelöscht)

**Nutzer hat zugestimmt, das anzugehen** (im letzten Chat mit „ja" bestätigt). Die Aufgabe für den neuen Chat: Zutatennamen in `js/classicsData.js` und `js/houseRecipes.js` durchgehen und auf echte, aktuell im Katalog vorhandene Produktnamen (oder sinnvolle Kategorie-Alternativen) abgleichen – ohne dabei Fakten zu erfinden. Bei generischen Klassikern (z. B. „Gin" in einem klassischen Gin Tonic) sollte man überlegen, ob eine spezifische Hausmarke sinnvoll ist oder ob die generische Bezeichnung bewusst bleibt (dann müsste stattdessen die Matching-Logik gruppen-bewusst gemacht werden, z. B. „Gin" gilt als vorhanden, wenn irgendein Produkt der Gruppe „Gin" angehakt ist). Diese Grundsatzfrage sollte am Anfang des neuen Chats mit dem Nutzer geklärt werden, bevor man loslegt – nicht einfach eine Marke raten.

## Technische Konventionen (für den neuen Chat wichtig)
- Playwright-Tests: `npm install playwright-core --no-save`, lokalen `python3 -m http.server` starten, testen, danach IMMER `node_modules`/`package.json`/`package-lock.json` wieder löschen vor dem Commit.
- Commits: aussagekräftige Messages, git push auf `claude/bartender-tool-webapp-y5ap9q`.
- Produktdaten: `getAllProducts()`/`getProduct()` aus `productLibrary.js`, Rezepte: `getAllRecipes()`/`getRecipe()` aus `recipeLibrary.js` – nie direkt aus den Daten-Dateien lesen.
- Bei allen Datenänderungen (Produkte, Preise, Aromaprofile, Zutatennamen): keine Fakten erfinden, nur was der Nutzer bestätigt hat oder was aus den echten Bestelllisten stammt.
