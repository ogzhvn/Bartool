import { buildRecipeBlocks } from "./recipeExport.js";
import { buildProductBlocks } from "./productExport.js";
import { escapeHtml, formatNumberDe } from "./utils.js";

// Druckansicht für ausgewählte Rezepte und Produkte.
//
// Die Listenansicht selbst zu drucken wäre unschön: dort stecken Auswahl-
// kästchen, Formularfelder und Bedienelemente drin. Stattdessen wird der
// Inhalt der ausgewählten Einträge in einen eigenen Bereich (#print-area)
// geschrieben, der nur beim Drucken sichtbar ist – aufgebaut aus denselben
// Bausteinen wie der Word-Export, damit Ausdruck und Word-Datei gleich
// aussehen.

const printAreaEl = document.getElementById("print-area");

function printBlocks(title, blocksHtml) {
  printAreaEl.innerHTML = `<h1>${escapeHtml(title)}</h1>${blocksHtml}`;
  document.body.classList.add("printing");

  const cleanUp = () => {
    document.body.classList.remove("printing");
    printAreaEl.innerHTML = "";
    window.removeEventListener("afterprint", cleanUp);
  };
  window.addEventListener("afterprint", cleanUp);

  // Kurz warten, damit der Browser den neuen Inhalt gerendert hat, bevor der
  // Druckdialog den Seitenumbruch berechnet.
  setTimeout(() => {
    window.print();
    // Sicherheitsnetz: Safari auf dem iPhone löst "afterprint" nicht
    // zuverlässig aus. Ohne diesen Fallback bliebe die Seite im Druckmodus
    // hängen und der Bildschirm wäre leer.
    setTimeout(cleanUp, 2000);
  }, 50);
}

export function printRecipes(recipes) {
  if (recipes.length === 0) return;
  printBlocks(
    recipes.length === 1 ? recipes[0].name : `Rezepte (${recipes.length})`,
    buildRecipeBlocks(recipes)
  );
}

export function printProducts(products) {
  if (products.length === 0) return;
  printBlocks(
    products.length === 1 ? products[0].name : `Produkte (${products.length})`,
    buildProductBlocks(products)
  );
}

// ---------------------------------------------------------------------
// Etiketten für Ansätze
//
// Bewusst ohne QR-Code: dafür bräuchte es eine zusätzliche Bibliothek, und
// das Projekt kommt ohne Fremdcode im Frontend aus. Auf dem Etikett steht
// das, was hinterm Tresen zählt – was drin ist und wie lange es noch gut ist.
// ---------------------------------------------------------------------

function formatLabelDate(value) {
  if (!value) return "–";
  return new Date(value).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function labelHtml(prep, typLabel, ersteller) {
  const zeilen = [
    prep.batchSizeMl ? `${formatNumberDe(prep.batchSizeMl)} ml` : "",
    prep.abv !== "" && prep.abv != null ? `${formatNumberDe(prep.abv)} % vol` : "",
    prep.location,
  ].filter(Boolean);

  return `
    <div class="label-card">
      <div class="label-name">${escapeHtml(prep.label)}</div>
      <div class="label-type">${escapeHtml(typLabel)}${zeilen.length ? " · " + escapeHtml(zeilen.join(" · ")) : ""}</div>
      <div class="label-dates">
        <span>Angesetzt<strong>${formatLabelDate(prep.madeAt)}</strong></span>
        <span>Haltbar bis<strong>${formatLabelDate(prep.expiresAt)}</strong></span>
      </div>
      ${prep.notes ? `<div class="label-note">${escapeHtml(prep.notes)}</div>` : ""}
      ${ersteller ? `<div class="label-note">Angesetzt von ${escapeHtml(ersteller)}</div>` : ""}
    </div>`;
}

// anzahl = wie oft dasselbe Etikett gedruckt wird (mehrere Flaschen je Ansatz).
export function printLabels(prep, typLabel, anzahl = 1, ersteller = "") {
  if (!prep) return;
  const menge = Math.max(1, Math.min(60, Number(anzahl) || 1));
  const karten = Array.from({ length: menge }, () => labelHtml(prep, typLabel, ersteller)).join("");
  printAreaEl.innerHTML = `<div class="label-sheet">${karten}</div>`;
  document.body.classList.add("printing", "printing-labels");

  const cleanUp = () => {
    document.body.classList.remove("printing", "printing-labels");
    printAreaEl.innerHTML = "";
    window.removeEventListener("afterprint", cleanUp);
  };
  window.addEventListener("afterprint", cleanUp);

  setTimeout(() => {
    window.print();
    setTimeout(cleanUp, 2000);
  }, 50);
}

// ---------------------------------------------------------------------
// Eventplan
//
// Was am Veranstaltungstag gebraucht wird, auf Papier: was gemixt wird,
// was aus dem Lager geholt werden muss und was es kostet. Bewusst ohne
// Bedienelemente – gedruckt wird der aufbereitete Bereich, nicht der Tab.
// ---------------------------------------------------------------------

function formatMengePrint(ml) {
  return ml >= 1000 ? `${formatNumberDe(ml / 1000)} l` : `${formatNumberDe(ml)} ml`;
}

function tabelle(kopf, zeilen) {
  if (zeilen.length === 0) return "";
  return `<table>
      <thead><tr>${kopf.map((k) => `<th>${escapeHtml(k)}</th>`).join("")}</tr></thead>
      <tbody>${zeilen.map((z) => `<tr>${z.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>`;
}

export function printEventPlan(event, ergebnis) {
  if (!event || !ergebnis) return;

  const datum = event.eventDate
    ? new Date(event.eventDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "–";

  const kopf = [
    ["Datum", escapeHtml(datum)],
    ["Gäste", event.guests ? formatNumberDe(event.guests) : "–"],
    ["Dauer", event.durationHours ? `${formatNumberDe(event.durationHours)} h` : "–"],
    ["Drinks gesamt", `${ergebnis.totalDrinks} (inkl. ${formatNumberDe(Number(event.bufferPercent) || 0)} % Puffer)`],
    ["Eisbedarf", `${formatNumberDe(ergebnis.iceKg)} kg`],
    ["Wareneinsatz", `${formatNumberDe(ergebnis.totalCost)} € · pro Gast ${formatNumberDe(ergebnis.costPerGuest)} €`],
  ]
    .map(([label, wert]) => `<p class="meta"><strong>${escapeHtml(label)}</strong> ${wert}</p>`)
    .join("");

  const drinks = tabelle(
    ["Rezept", "Anteil", "Anzahl", "Batchmenge", "ABV"],
    ergebnis.drinks.map((d) => [
      escapeHtml(d.recipeName),
      `${formatNumberDe(d.share)} %`,
      String(d.count),
      d.found ? formatMengePrint(d.batchMl) : "–",
      d.found && d.abv !== null ? `${formatNumberDe(d.abv)} % vol` : "–",
    ])
  );

  const entnahme = tabelle(
    ["Zutat", "Menge", "Gebinde", "Lieferant", "Kosten"],
    ergebnis.volumeLines.map((l) => [
      escapeHtml(l.name),
      formatMengePrint(l.ml),
      l.bottles !== null ? `${l.bottles} × ${formatMengePrint(l.bottleSizeMl)}` : "Gebinde unbekannt",
      l.supplier ? escapeHtml(l.supplier) : "–",
      l.priceKnown ? `${formatNumberDe(l.cost)} €` : "kein Preis hinterlegt",
    ])
  );

  const stueck = tabelle(
    ["Zutat", "Menge", "Lieferant"],
    ergebnis.pieceLines.map((l) => [
      escapeHtml(l.name),
      `${formatNumberDe(Math.ceil(l.amount))} ${escapeHtml(l.unit)}`,
      l.supplier ? escapeHtml(l.supplier) : "–",
    ])
  );

  const notiz = event.notes ? `<p class="meta"><strong>Notiz</strong> ${escapeHtml(event.notes)}</p>` : "";
  const hinweis =
    ergebnis.missingPrices.length > 0
      ? `<p class="history">Ohne hinterlegten Einkaufspreis und deshalb mit 0 € gerechnet: ${escapeHtml(
          ergebnis.missingPrices.join(", ")
        )}.</p>`
      : "";

  printBlocks(
    event.name || "Eventplan",
    `${kopf}${notiz}
     <h2>Drinks</h2>${drinks}
     <h2>Entnahme-/Einkaufsliste</h2>${entnahme || "<p>Keine Volumenzutaten.</p>"}
     ${stueck ? `<h2>Stückzutaten</h2>${stueck}` : ""}
     ${hinweis}`
  );
}

// ---------------------------------------------------------------------
// Checklisten-Nachweis
//
// Was bei einer Kontrolle gefragt wird: welche Liste, an welchem Tag,
// welcher Punkt, welcher Messwert, von wem und wann. Die Läufe kommen
// fertig aufbereitet aus js/checklists.js herein – wie beim Eventplan
// rechnet und formatiert das Fachmodul, hier passiert nur der Druck.
// Erwartetes Format je Lauf:
// { titel, meta: [[label, wert], ...], zeilen: [[punkt, ergebnis, von, zeitpunkt, notiz], ...] }
// ---------------------------------------------------------------------

export function printChecklistRuns(laeufe, titel = "Checklisten-Nachweis") {
  if (!Array.isArray(laeufe) || laeufe.length === 0) return;

  // Bei einem einzelnen Lauf steht der Name schon in der Überschrift –
  // dann keine zweite gleichlautende Zeile darunter.
  const einzeln = laeufe.length === 1;

  const bloecke = laeufe
    .map((lauf) => {
      const kopf = (lauf.meta ?? [])
        .map(([label, wert]) => `<p class="meta"><strong>${escapeHtml(label)}</strong> ${escapeHtml(wert)}</p>`)
        .join("");
      const zeilen = tabelle(
        ["Punkt", "Ergebnis", "Von", "Zeitpunkt", "Notiz"],
        (lauf.zeilen ?? []).map((z) => z.map((c) => escapeHtml(c)))
      );
      const ueberschrift = einzeln ? "" : `<h2>${escapeHtml(lauf.titel)}</h2>`;
      return `${ueberschrift}${kopf}${zeilen || "<p>Keine Punkte in dieser Vorlage.</p>"}`;
    })
    .join("");

  printBlocks(laeufe.length === 1 ? laeufe[0].titel : titel, bloecke);
}
