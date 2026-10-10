# Testbericht – Handy-Viewport (10.10.2026)

Getestet wurde Stand `eab058c` mit Playwright/Chromium im Viewport 390×844 (iPhone 13).
Testkonten waren `claude-test` (Admin, Bar) und `claude-test-wgr` (Barkeeper, WGR), beide Sprachen DE/EN.
Getestet wurde gegen die Produktiv-DB. Alle Schreibtests liefen mit dem Präfix `ZZ-Test` und sind wieder gelöscht,
Restkontrolle per SQL: 163 Rezepte, 371 Produkte wie vor dem Test.

Schweregrade: **kritisch** = Sicherheit oder falsche Zahlen ohne Warnung · **mittel** = stört
im Betrieb oder führt in die Irre · **klein** = Kosmetik, Validierung, Texte.

## Kritisch

### K1 – Gespeichertes XSS im Verdünnungsrechner
`js/dilution.js:120` setzt `i.name` ungeescaped in `innerHTML`.
- Live nachgewiesen. Der Weg: ein Produkt mit HTML im Namen, ein Rezept mit genau diesem Produkt als Zutat,
  dann „Rezept laden“ im Tab Verdünnung & ABV. Das Script läuft bei **jedem** Nutzer, der das macht.
- Auch die direkte Eingabe im Zutatenfeld führt Code aus.
- Fix: `escapeHtml(i.name)`. Der grep über alle Module hat sonst keine weitere Stelle gefunden. Rezepte,
  Produkte, Schnellsuche, Betrieb, Feedback und Audit escapen korrekt (XSS-Probe mit über 30 Feldern negativ).

## Mittel

### M1 – Verdünnung: Zutaten ohne ABV fallen still aus dem Volumen
Beim „Rezept laden“ bekommen Säfte und Sirupe (`abv = null` im Katalog) ein leeres ABV-Feld. Die Zeile wird dann
komplett aus der Rechnung gefiltert (`dilution.js:62`), das Ergebnis aber trotzdem angezeigt.
- Old Cuban: angezeigt werden 40,18 % ABV bei 46,8 ml. Richtig wären ca. 23 % bei 81,8 ml (ohne Champagner).
- Ein Hinweis „bitte selbst eintragen“ steht zwar da, die große Zahl unten ist aber falsch.
- Vorschlag: Ohne Alkoholgehalt mit 0 % rechnen oder das Ergebnis zurückhalten, bis alle Zeilen ein ABV haben.

### M2 – `getProduct()` vergleicht exakt statt per Teilstring
`js/productLibrary.js:18` nutzt `p.name === name`. „Taittinger Brut Réserve (zum Auffüllen)“ findet deshalb kein
Produkt, also kein ABV und keinen Preis. Das widerspricht der Matching-Regel (Teilstring) aus `CLAUDE.md`.
Folgen: Verdünnungsrechner (siehe M1) und Event-Planer (Old Cuban 14,83 % statt ca. 19 %).

### M3 – Kalkulations-Rechner warnt nicht bei fehlenden Preisen
`js/calculation.js`: Old Cuban ergibt 0,63 € Verkaufspreis, obwohl 5 von 6 Zutaten keinen Einkaufspreis haben.
Event-Planer und Karte warnen in diesem Fall, der Rechner nicht.
Datenlage: 347 von 372 Produkten haben keinen Einkaufspreis, u. a. Bombay, Havana 7 und Taittinger.

### M4 – Alte Testdaten in Produktion
„ZZ-Test Produkt“, „… B“ und „… C“ (Gruppe „ZZ-Test Gruppe“, Stand 03.10.2026) sind für alle sichtbar:
Schnellsuche, Katalog, Inventurliste, Zähler „371 Produkte“. Nicht von diesem Test; **nicht gelöscht**, bitte freigeben.

### M5 – Suche ist nicht akzentunabhängig
„pina colada“ findet „Piña Colada“ nicht, „anos“ findet „Havana Club 7 Años“ nicht.
Betrifft Rezeptsuche und Schnellsuche. Am Tresen tippt niemand Tilden.

### M6 – Änderungsverlauf voller Login-Rauschen
Jeder Login schreibt „Konto geändert · last_login_at“ ins `audit_log`. Das sind 647 von 2.200 Einträgen (29 %),
heute fast alle neuen Zeilen. Echte Änderungen gehen darin unter. Vorschlag: `last_login_at` im Audit-Trigger ignorieren.

### M7 – Offline-Start zeigt 7 s die Login-Maske
Gespeicherte Sitzung, kein Netz, App neu öffnen: 7,2 s ist die Anmeldemaske zu sehen, erst dann erscheint die App.
Wer in der Zeit versucht, sich anzumelden, scheitert. Danach steht in der Kopfzeile der E-Mail-Präfix statt des Namens,
die Rolle fehlt („Rollen konnten nicht geladen werden“).

### M8 – Tabwechsel setzt die Scrollposition nicht zurück
In `js/tabs.js` gibt es kein `scrollTo`. Wer im Produktkatalog weit unten ist und den Tab wechselt, landet auf der
neuen Seite mitten oder unten. Auf dem Handy fällt das ständig auf.

## Klein

| # | Bereich | Befund |
|---|---|---|
| N1 | Verdünnung | ABV > 100 akzeptiert (150 %), negative Verdünnung (−10 % → −8,64 ml), negative Menge wird still verworfen |
| N2 | Superjuice / Sirup | Negative Eingaben ergeben negative Gramm und „-0 g“; Faktor Apfelsäure 0,333 vs. Zitronensäure 0,6667 (33 g → 10,99 g statt 11 g) |
| N3 | Batching | Basis-Portionen 0 wird still als 1 gerechnet; Ziel 0, leer oder negativ lässt das Ergebnis ohne Hinweis verschwinden |
| N4 | Layout | `select` in Checklisten (Vorlage) und „Was kann ich bauen?“ (Zählung) ist breiter als der Viewport → horizontaler Scroll (Seite 407–415 px bei 390) |
| N5 | Quiz / Reporting | Sortierknöpfe der Rangliste nur 14 px hoch (Touch-Target) |
| N6 | i18n EN | Einheiten „BL“, „Stück“, „Teile“ im Zutateneditor; „inkl.“ in der Kalkulations-Leiste; „Prüfvermerk“ in der Datenqualität |
| N7 | Start | Kacheln „163 Rezepte im Buch“ und „163 davon eigene“ sind seit dem Wegfall der statischen Daten immer gleich |
| N8 | Konsole | 403 auf `rpc/quiz_question_difficulty` bei jedem Start ohne `reports.view` (abgefangen, nur Rauschen; vorher `can()` prüfen) |
| N9 | Kalkulation | Zielquote > 100 und negative MwSt. werden akzeptiert |
| N10 | Batching „Teilen“ | Ohne `navigator.share` und ohne Clipboard-Recht: unbehandelte Promise-Rejection, keine Rückmeldung |
| N11 | Favoriten | Button behält `aria-label` „Als Favorit merken“, kein `aria-pressed` nach dem Umschalten |
| N12 | Mise en Place | „Haltbar bis“ vor „Angesetzt am“ wird akzeptiert (sofort „seit 9 Tagen abgelaufen“). Admin: keine Vorauswahl bei „Sichtbar für“, erst nach dem Absenden kommt ein `alert` |
| N13 | Checklisten | Messwert „abc“ wird ohne Hinweis verworfen |
| N14 | Inventur | Wert −2 + Speichern: keine Meldung, weder Fehler noch Bestätigung |
| N15 | Quiz | Rangliste nach Rundenende nicht aktualisiert („Noch hat niemand …“ bis zum Neuladen) |
| N16 | Quiz-Inhalt | Rusty Nail Glas: Distraktor „Tumbler oder Cocktailschale“ überschneidet sich mit der richtigen Antwort |
| N17 | Quiz | Testkonten stehen in der Rangliste echter Mitarbeiter; Vorschlag `quiz_visible = false` für `claude-test*` |
| N18 | Vorschläge | Admin sieht rohe Feldnamen (`method:`, `basePortions:`) und rohes JSON der Zutaten; ein neues Rezept heißt „Änderung“ |
| N19 | Änderungsverlauf | Einziger Inhalt hinter zugeklapptem Accordion (Überschrift doppelt); Laden > 1,5 s ohne Ladeanzeige; Feldnamen und ISO-Zeitstempel roh |
| N20 | Rollen | „1 Konten“ statt „1 Konto“ |

## Geprüft und in Ordnung

- **Batching:** Portionen, Volumen, Flaschen, Verdünnung %, Ziel-ABV; alle Werte von Hand nachgerechnet, unerreichbare Ziele werden sauber gemeldet.
- **Verdünnung, Sirup, Superjuice:** Formeln korrekt; die Superjuice-Faktoren entsprechen der verbreiteten Faustformel.
- **Event-Planer:** Drinks, Eis, Batchmengen, Einkaufsliste und Kosten stimmen; Warnungen bei Anteilsumme ≠ 100 % und fehlenden Preisen sind vorhanden.
- **Datentrennung:** WGR sieht keine Bar-Daten in Mise en Place, Events, Übergabe, Checklisten, Inventur und Schwund.
- **RLS aus der Konsole (als WGR):** Insert in Produkte und Rechte, Update fremder Rezepte, eigene Rolle hochsetzen, Edge Function `admin-users`, fremde Betriebsdaten lesen – alles abgewiesen.
- **Ablauf Vorschlag → Ablehnung**, Feedback mit 2.000-Zeichen-Limit, Konto-Validierung, Abteilungs-Sichtbarkeit, Deep-Links auf gesperrte Tabs (→ Start).
- **Offline:** Service Worker aktiv (`bartool-v128`), Banner korrekt, Rezepte und Rechner nutzbar, Speichern wird mit Meldung blockiert.

## Nicht geprüft / Einschränkungen

- Realtime-WebSocket bekam im Test-Container HTTP 500. Vermutlich liegt das am Proxy des Containers, nicht verifiziert.
- Druckansichten, Excel-Import und -Export, Fotos, Passwort ändern und Konto anlegen bis zum Ende (wurden bewusst nicht ausgeführt, um echte Konten nicht anzufassen).
- Tablet- und Desktop-Viewport.
