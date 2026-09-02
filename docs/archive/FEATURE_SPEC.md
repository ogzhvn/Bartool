# Bartool – Feature-Spezifikation: Aromenmatrix, Verkaufsmatrix, Empfehlungssystem, Redesign

**Historisches Planungsdokument, nicht mehr aktueller Stand:** Die hier beschriebene Aromenmatrix (Score-Algorithmus `compatibilityScore()`) und die Verkaufsmatrix wurden inzwischen wieder entfernt – der Score klebte bei fast allen Produktpaaren am selben Wert, und ein einzelner 0–100-Score suggerierte mehr Präzision, als die aus Tasting Notes abgeleiteten Aromaprofile hergeben. Cross-Sell und "Ähnlich wie …" (im Empfehlungen-Tab) laufen jetzt auf rein manuell kuratiertem `pairsWith` bzw. echter Zutaten-Überlappung, ohne Aroma-Score-Fallback. Der Rest dieser Datei bleibt als Kontext stehen, beschreibt aber nicht mehr den Ist-Zustand.

Diese Spec ist so geschrieben, dass sie direkt an Claude Code übergeben werden kann. Sie basiert auf dem tatsächlichen Ist-Zustand des Repos (Stand: geklont von `github.com/ogzhvn/Bartool`, statisches HTML/CSS/JS ohne Build-Schritt, ein JS-Modul pro Feature unter `js/`, `localStorage` als einzige Datenhaltung, Tabs über `tabs.js` + `data-tab`/`.tab-panel`).

## 0. Wie diese Spec zu benutzen ist

Nicht als ein einziger "bau mir das alles"-Prompt verwenden. Abschnitt 7 gibt eine Reihenfolge vor – jeden Schritt einzeln an Claude Code geben, danach die App im Browser durchklicken und erst dann den nächsten Schritt anstoßen. Das entspricht auch, wie der bestehende Code aufgebaut ist: ein fokussiertes Modul pro Feature, keine große Rewrite-Aktion.

## 1. Ausgangslage (kurz)

- `js/main.js` importiert und initialisiert pro Feature ein Modul (`initBatching()`, `initRecipes()`, …). Ein neues Feature = ein neues Modul + eine neue `initX()`-Funktion + ein Import in `main.js`.
- Tabs: `<button class="tab-btn" data-tab="...">` in `index.html` + `<section id="..." class="tab-panel">`. `switchTab()` in `tabs.js` togglet nur CSS-Klassen – dieser Mechanismus bleibt unverändert.
- `storage.js` folgt für jeden Datentyp demselben Muster: `KEY` (localStorage-Key) + `*_UPDATED_EVENT` (CustomEvent) + `load*()`/`save*()`/`delete*()`/`on*Changed()`. Jede neue Datenart hält sich an dieses Muster.
- `recipeLibrary.js` und `productLibrary.js` mischen eigene (localStorage) mit mitgelieferten Daten (`classicsData.js`, `houseRecipes.js`, `productsData.js`) nach Priorität custom > house > generisch. Neue Features lesen Rezepte/Produkte **immer** über `getAllRecipes()`/`getAllProducts()`, nie direkt aus den Daten-Dateien.
- `calculation.js` (Tab „Kalkulation") kann bereits Wareneinsatz und empfohlenen Verkaufspreis pro Rezept berechnen – aktuell aber nur mit Preisen, die bei jeder Berechnung neu von Hand eingetippt werden. Das wird unten (2.2) zur Grundlage für die Trade-up-Vorschläge in der Verkaufsmatrix ausgebaut.

**Änderungshinweis:** In einer ersten Version dieser Spec war „Verkaufsmatrix" als klassische Menu-Engineering-Matrix (Beliebtheit vs. Marge) definiert. Nach Rückfrage ist gemeint: ein Werkzeug, das Mitarbeitenden live im Gespräch mit dem Gast beim Verkaufen hilft. Abschnitt 4 unten ist entsprechend komplett neu gefasst; Abschnitt 2.3 (Verkaufszahlen-Erfassung) ist dadurch kein Fundament mehr, sondern optional.

## 2. Datenmodell-Erweiterungen (Fundament für alle vier Features)

### 2.1 Produkt: Aromaprofil (`flavorProfile`)

Neues optionales Feld an jedem Produkt-Objekt (`js/productsData.js` sowie das nutzereigene Produktformular):

```js
flavorProfile: {
  suess: 0,      // 0–10
  sauer: 0,
  bitter: 0,
  herbKraeuterig: 0,
  fruchtig: 0,
  wuerzigScharf: 0,
  floral: 0,
  rauchig: 0,
  erdigHolzig: 0,
  nussig: 0,
  cremig: 0,
  salzigMineralisch: 0,
}
```

Erweiterungen:
- `js/products.js`: `FIELDS` um die 12 Dimensionen ergänzen (Zahlen-/Range-Inputs 0–10), analog zum bestehenden Muster mit `nameEl`/`categoryEl` etc.
- `index.html`, Abschnitt „Produkt bearbeiten": neuer Bereich „Aromaprofil" mit 12 kompakten Reglern.
- **Migration der ~150 mitgelieferten Produkte in `productsData.js`:** Diese haben noch kein `flavorProfile`. Einmaliges Skript/Prompt an Claude Code: aus dem bestehenden Freitext `tastingNotes` je Produkt ein Startprofil ableiten (Keyword-Mapping, z. B. „Zitrus/frisch" → sauer+fruchtig hoch, „Wacholder/Kräuter" → herbKraeuterig hoch, „süß/Vanille" → suess hoch, „Bitterlikör" → bitter hoch, „rauchig/Torf" → rauchig hoch, „Rose/Blüten" → floral hoch, „pfeffrig/würzig" → wuerzigScharf hoch, „Eiche/Fass" → erdigHolzig hoch, „Mandel/Nuss" → nussig hoch, „Sahne/Kokos" → cremig hoch, „Meersalz/mineralisch" → salzigMineralisch hoch). Ergebnis ist ein grober Startwert, keine Wahrheit – Nutzer korrigiert später von Hand über das Formular. Stand nach der Erweiterung auf die feinere 0–10-Skala und die vier zusätzlichen Dimensionen: 304 von 309 Produkten haben ein (neu berechnetes) Profil.
- Produkte ohne (oder mit komplett leerem) `flavorProfile` gelten als „unbekannt" und werden aus Matrix-Berechnung und Empfehlungssystem ausgeschlossen statt fälschlich als „passt schlecht" gewertet.

### 2.2 Produkt: Einkaufspreis (`priceValue` / `priceUnit`)

```js
priceValue: 0,          // Zahl
priceUnit: "liter",     // "liter" | "stueck"
```

- Ergänzung im Produktformular („Einkaufspreis").
- **Wichtiger Refactor:** Die Kostenlogik aus `calculation.js` (`ingredientCost()`, Preislabel je nach Einheit) in eine eigene, exportierte Funktion auslagern (z. B. neues Modul `js/costing.js` mit `calculateRecipeCost(recipe)`), die für ein Rezept automatisch die Preise der zugehörigen Produkte über `getProduct(name)` (aus `productLibrary.js`) nachschlägt, statt dass der Preis bei jeder Kalkulation neu eingetippt wird. Der Preis bleibt im Kalkulations-Tab weiterhin manuell überschreibbar (Autofill, kein Zwang). Diese gemeinsame Funktion wird sowohl vom bestehenden Kalkulations-Tab als auch von der neuen Verkaufsmatrix (Abschnitt 4) genutzt – zwei getrennte Kostenrechnungen wären ein Wartungsrisiko.

### 2.3 Verkaufszahlen – zurückgestellt, kein Fundament mehr

In der ersten Version dieser Spec war eine Verkaufszahlen-Erfassung (`bartool.sales`, Rezept + Monat + Menge) die Grundlage für eine Menu-Engineering-Matrix. Nach der Klarstellung in Abschnitt 4 ist die Verkaufsmatrix jetzt ein Live-Empfehlungswerkzeug, kein Popularitäts-/Margen-Reporting – dafür werden keine Verkaufszahlen gebraucht. **Deshalb vorerst weglassen.** Falls später gewünscht („zeig bevorzugt, was sich eh schon gut verkauft"), lässt sich das als zusätzliche Gewichtung in Modus 1 der Verkaufsmatrix nachrüsten, ist aber kein Baustein, der vorgezogen werden sollte.

### 2.4 Produkt & Rezept: `quickPitch` und `pairsWith`

Zwei neue optionale Felder, sowohl an Produkt- als auch an Rezept-Objekten (`productsData.js`/eigene Produkte, `classicsData.js`/`houseRecipes.js`/eigene Rezepte):

```js
quickPitch: "",   // 1 kurzer, service-tauglicher Satz zum Nachsprechen
pairsWith: [],    // Namen anderer Produkte/Rezepte, die gut dazu passen (manuell kuratiert)
```

Formular-Ergänzung in „Produkt bearbeiten" und „Rezept bearbeiten": je ein einzeiliges Textfeld für `quickPitch`, ein Tag-Feld für `pairsWith` mit Autocomplete über bestehende Produkt-/Rezeptnamen. Beide Felder sind optional – die Verkaufsmatrix (Abschnitt 4) muss auch ohne sie funktionieren, über die dort beschriebenen Fallbacks.

## 3. Feature: Aromenmatrix (Kompatibilitätsmatrix zwischen Zutaten)

Neuer Tab „Aromenmatrix" (`data-tab="aroma-matrix"`), neues Modul `js/aromaMatrix.js`.

**Score-Berechnung** `compatibilityScore(productA, productB) → 0–100`, exportiert (wird in Abschnitt 5 wiederverwendet):

1. *Profil-Kompatibilität* – **nicht** einfache Ähnlichkeit. Manche Paarungen funktionieren gerade wegen Kontrast (süß+sauer, bitter+süß), andere wegen Übereinstimmung (fruchtig+fruchtig). Dafür eine feste 8×8-Gewichtungstabelle zwischen den Dimensionen von Hand hinterlegen (z. B. süß↔sauer = hohe Kompatibilität, süß↔süß = mittel, bitter↔süß = hoch, rauchig↔fruchtig = niedriger) statt reiner Cosinus-Ähnlichkeit.
2. *Co-Occurrence-Bonus* – wie oft beide Zutaten bereits gemeinsam in `getAllRecipes()` vorkommen, als zusätzlicher, kleinerer Faktor (Richtwert: 70 % Profil-Score, 30 % Co-Occurrence-Bonus), da die Rezeptdatenbank zu klein ist, um allein darauf zu bauen.

**UI:**
- Standardansicht: **eine** Zutat auswählen (oder bis zu 3), dagegen alle anderen als sortierte Liste/Balken nach Score – **kein** vollständiges Zutat×Zutat-Raster als Default. Bei 150+ Produkten wären das 20.000+ Zellen, das würde den Browser ausbremsen; das muss in der Umsetzung explizit vermieden werden.
- Optionale Voll-Raster-Ansicht nur gefiltert auf eine Produktgruppe (max. ca. 30 Einträge gleichzeitig).
- Klick auf ein Paar öffnet Detail: gemeinsame Aroma-Dimensionen, Rezepte, die beide bereits kombinieren, „passt außerdem gut zu…" (Top-3-Nachbarn).
- Farbskala für die Heatmap an bestehende `--accent`-Farbe anlehnen (siehe Abschnitt 6), damit es zum Rest der App passt.

## 4. Feature: Verkaufsmatrix (Verkaufsassistent: Live + Vorbereitung)

Kein Diagramm/Chart, sondern ein Werkzeug, das Mitarbeitende beim Verkaufen von Spirituosen/Cocktails unterstützt – Barkeeper/Service, nicht Management/Reporting. Es hat **zwei Betriebsarten mit unterschiedlichen Anforderungen**, umgeschaltet über zwei große Reiter ganz oben im Tab:

- **Live** – während des Gesprächs mit dem Gast. Tempo ist alles: wenige Taps, große Touch-Ziele, kein Scrollen durch Formulare, kein Tippen von Fließtext, während der Gast wartet.
- **Vorbereitung** – zum Durchlesen vor Schichtbeginn, in Ruhe, ohne Zeitdruck. Hier darf es textlastiger und vollständiger sein als im Live-Modus.

Beide bleiben dauerhaft nebeneinander bestehen – die Vorbereitung ist eine Ergänzung zum Live-Modus, kein Ersatz.

Neuer Tab „Verkaufsmatrix" (`data-tab="sales-matrix"`), neues Modul `js/salesMatrix.js`.

### Live-Modus

Vier Modi als große, permanent sichtbare Umschalter oben im Live-Bereich (kein Dropdown – kostet im Service zu viel Zeit):

**Modus 1 – Guest-Wunsch → Empfehlung** (Startmodus, wird beim Öffnen des Tabs sofort gezeigt)
Mitarbeiter tippt entweder (a) 1–3 Aroma-Chips an – dieselben 8 Dimensionen aus 2.1 als große Buttons (süß, sauer, bitter, herb/kräuterig, fruchtig, würzig/scharf, floral, rauchig) – oder (b) tippt den Namen eines Drinks/einer Spirituose ein, die der Gast bereits kennt/mag. Das System rankt Rezepte und Produkte über `compatibilityScore()` (Abschnitt 3) gegen die gewählten Dimensionen bzw. gegen das Aromaprofil des genannten Referenzprodukts. Ausgabe: Top 3–5 Treffer, pro Treffer **eine einzige** Pitch-Zeile zum direkten Nachsprechen (aus `quickPitch`, 2.4) – nicht die volle Produktwissen-Seite, dafür ist mitten im Service keine Zeit.

**Modus 2 – Trade-up-Leiter je Kategorie**
Für den Fall, dass der Gast sich schon entschieden hat (z. B. „einen Gin Tonic"). Mitarbeiter wählt das aktuell übliche/bestellte Produkt aus, das Tool zeigt die 1–2 nächsthöheren Produkte **derselben Gruppe/Untergruppe** (`group`/`subGroup`, existiert bereits in `productsData.js`), automatisch sortiert nach `priceValue` (2.2) – keine separate, manuell zu pflegende Tier-Stufe nötig. Pro Vorschlag wieder eine kurze `quickPitch`-Zeile („X kostet nur 1,50 € mehr und bringt dafür …"). Hat eine Gruppe/Untergruppe weniger als 2 Produkte mit hinterlegtem `priceValue`, zeigt das Modul „keine Preisdaten für Trade-up in dieser Kategorie hinterlegt" statt falsch zu sortieren oder zu raten.

**Modus 3 – Verkaufs-Spickzettel**
Kompakte Kartenansicht (großer Titel, 2–3 Stichpunkte, große Schrift) für ein einzelnes Produkt oder Rezept – zum kurzen Draufschauen mitten im Service statt der vollen Produktwissen-Seite. Inhalt: `quickPitch` falls gepflegt, sonst automatischer Fallback auf die ersten Sätze aus den bereits vorhandenen Feldern `story`/`tastingNotes`. Diese Ansicht ist im Kern ein zweiter, verdichteter Renderer für Daten, die in „Produktwissen"/„Rezepte" schon existieren – keine neue Datenquelle nötig außer dem optionalen `quickPitch`.

**Modus 4 – Cross-Sell / Kombinationsvorschläge**
Zu einem bestellten Rezept oder Produkt „passt außerdem gut" anzeigen, um den Bon-Wert zu erhöhen. Priorität: (a) manuell gepflegtes `pairsWith` (2.4), falls vorhanden – immer genauer als jede Heuristik; (b) sonst algorithmischer Fallback über `compatibilityScore()` **plus** der Regel „andere Kategorie/Gruppe als das Ausgangsprodukt", damit z. B. nach einem Cocktail sinnvoll ein Digestif vorgeschlagen wird statt ein zweiter, fast identischer Cocktail.

Alle vier Live-Modi laufen ohne Tastatur/Formular aus, wo immer möglich (Chips/Buttons statt Texteingabe) – das Ziel ist, dass eine Empfehlung in 2–3 Taps steht, nicht, dass jede erdenkliche Option abgedeckt ist.

### Vorbereitungsmodus / Schicht-Briefing

Zeigt dieselben Grunddaten wie der Live-Modus (`quickPitch`, Trade-up-Positionen, `pairsWith`), aber als vollständige, linear von oben nach unten lesbare Liste statt als schnelle Treffer-Auswahl – zum ruhigen Durchlesen vor der Schicht, keine Zeitnot:

- Gegliedert nach Produktgruppe/-untergruppe – dieselbe Sortierung wie im bestehenden Tab „Produktwissen" (`GROUP_ORDER`/`SUBGROUP_ORDER` aus `products.js` wiederverwenden statt eine zweite Sortierlogik zu pflegen).
- Pro Gruppe die **komplette** Trade-up-Leiter (nicht nur die Top 1–2 wie im Live-Modus), jeweils mit der `quickPitch`-Zeile dahinter.
- Eigener Abschnitt „Cocktails": alle Rezepte mit gepflegtem `quickPitch` und/oder `pairsWith`, alphabetisch.
- Suche/Filter wie in „Produktwissen" (bestehendes Muster wiederverwenden, keine neue UI-Sprache erfinden).
- Druckbar: eine einfache `@media print`-Regel im bestehenden `styles.css` reicht, damit sich das Briefing über den Browser drucken oder als PDF sichern lässt – dafür ist keine neue Export-Bibliothek nötig (die vorhandene `recipeExport.js` ist für den Excel/Word-Export der Rezeptliste da, nicht für diesen Fall).
- Optional, nicht für die erste Version: Filter „nur unvollständige Einträge" (Produkte/Rezepte ohne `quickPitch`) – hilft demjenigen, der die Daten pflegt, zu sehen, wo noch Pitch-Texte fehlen; kein Kernfeature für den lesenden Mitarbeiter.

## 5. Feature: Rezeptempfehlungssystem

Neuer Tab „Empfehlungen" (`data-tab="recommendations"`), neues Modul `js/recommendations.js`. Zwei Modi als Umschalter innerhalb des einen Tabs (kein zweiter Top-Level-Tab):

**Modus A – „Was kann ich aus meinem Bestand machen?"**
Checkliste vorhandener Produkte (Basis: `getAllProducts()`). Für jedes Rezept aus `getAllRecipes()` einen Deckungsgrad berechnen: (Anzahl vorhandener Zutaten) / (Anzahl Zutaten gesamt). Sortiert absteigend – erst 100 %-Treffer, danach „dir fehlt nur: X" für Rezepte, denen genau eine Zutat fehlt, damit auch Beinahe-Treffer sichtbar werden. Eine Liste „meist vorrätig" (Wasser, Eis, Standard-Garnitur) bewusst erstmal weglassen, um das nicht zu überkonstruieren, bevor die Grundversion läuft.

**Modus B – „Ähnlich wie …"**
Ein Rezept auswählen, alle anderen nach einem Score aus Zutaten-Überlappung **plus** `compatibilityScore()` (paarweise gemittelt über beide Zutatenlisten) ranken – „Gästen, die X mochten, biete auch Y an."

Optionale Erweiterung (erst nachdem A und B laufen): Umschalter „margenstarke Vorschläge bevorzugen", der die Sortierung mit den über `calculateRecipeCost()` (2.2) berechneten Margendaten gewichtet, sofern für das Rezept Preisdaten vorhanden sind.

Modus B teilt sich die Score-Logik mit Modus 1 der Verkaufsmatrix (Abschnitt 4) – beide nutzen `compatibilityScore()` aus Abschnitt 3, nur mit unterschiedlichem Ausgangspunkt: hier „ähnliches Rezept zu einem bestehenden", dort „passendes Rezept zu einem Geschmackswunsch". Der Unterschied zur Verkaufsmatrix: Dieser Tab ist für den Barkeeper gedacht, der überlegt, was er mit seinem Vorrat mixen kann – nicht für das Verkaufsgespräch am Tresen.

## 6. Redesign / UI

**Ist-Zustand:** eine flache, zentrierte, umbrechende Tab-Leiste (`.tabs`) mit aktuell 9 Buttons. Mit den 3 neuen Tabs wären es 12 – das wird unübersichtlich.

**Empfehlung:** flache Tab-Leiste durch eine linke Sidebar-Navigation ersetzen (unter ca. 700px Breite zu einem Dropdown/Hamburger-Menü zusammenklappend), gruppiert nach der tatsächlichen Struktur der App:

- **Rechner:** Batching, Superjuice, Zuckersirup, Verdünnung & ABV, Kalkulation
- **Bibliothek:** Rezepte, Rezept bearbeiten, Produktwissen, Produkt bearbeiten
- **Insights** (neu): Aromenmatrix, Verkaufsmatrix, Empfehlungen

Der Kern-Mechanismus in `tabs.js` (`data-tab`/`.tab-panel`-Toggle) bleibt unverändert – es ist nur ein neuer Nav-Container, kein Routing-Umbau. Das hält das Risiko klein, nicht alles auf einmal zu zerschießen.

**Visuell:** die bestehende warme, dunkle Farbwelt beibehalten (passt thematisch zur Bar), aber das Token-System in `css/styles.css` (aktuell 8 CSS-Variablen in `:root`) systematisch erweitern, statt für die neuen Matrix-Ansichten Farben ad hoc zu erfinden:

```css
--heat-low: ...      /* kühl/entsättigt, unteres Ende der Aromenmatrix-Heatmap */
--heat-high: var(--accent);
--radius-lg: ...;
--shadow-card: ...;
```

Für den **Live-Modus** der Verkaufsmatrix (Abschnitt 4) gilt eine eigene Anforderung: Er wird im Stehen, mit dem Gast vor sich, bedient – Buttons/Chips entsprechend groß (Touch-Ziel min. ca. 44×44px), hoher Kontrast, Ergebnis nach 2–3 Taps ohne Scrollen sichtbar. Das ist bewusst eine andere Priorität als bei den übrigen, eher am Schreibtisch genutzten Tabs (Kalkulation, Produkt/Rezept bearbeiten). Der **Vorbereitungsmodus** derselben Verkaufsmatrix folgt dagegen eher der Lese-Priorität von „Produktwissen": Vollständigkeit und Scrollen sind hier in Ordnung, Tempo ist zweitrangig.

Für Empfehlungen (Abschnitt 5) das bereits bewährte Zweispalten-Layout „Hauptbereich + Sidebar" aus `product-edit`/`recipe-edit` (`.recipe-edit-layout`) wiederverwenden statt eine neue Layout-Sprache zu erfinden.

## 7. Empfohlene Umsetzungsreihenfolge

1. **Datenmodell** (2.1, 2.2, 2.4 – 2.3 zurückgestellt) + Kosten-Refactor (`costing.js`) – Fundament, auf dem alles andere aufbaut.
2. **Redesign/Navigation** (Abschnitt 6) – zuerst, damit jeder neue Tab direkt in die neue Struktur eingehängt wird statt zweimal umgebaut zu werden.
3. **Aromenmatrix** (Abschnitt 3) – liefert `compatibilityScore()`, das sowohl die Verkaufsmatrix als auch das Empfehlungssystem brauchen.
4. **Verkaufsmatrix** (Abschnitt 4) – braucht `compatibilityScore()` aus Schritt 3 sowie `priceValue`/`quickPitch`/`pairsWith` aus Schritt 1.
5. **Empfehlungssystem** (Abschnitt 5) – baut ebenfalls auf Schritt 3 auf, unabhängig von Schritt 4.

## 8. Übergabe an Claude Code

Diese Datei als `FEATURE_SPEC.md` ins Repo-Root legen. Pro Schritt aus Abschnitt 7 einen eigenen, klar abgegrenzten Prompt geben (z. B. „Setze Abschnitt 2 und 6 aus FEATURE_SPEC.md um, die drei neuen Tabs aus Abschnitt 3–5 aber noch nicht anlegen"). Nach jedem Schritt die App im Browser öffnen und durchklicken, bevor der nächste Schritt losgeht.
