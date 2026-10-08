import { buildRecipeBlocks } from "./recipeExport.js";
import { buildProductBlocks } from "./productExport.js";
import { escapeHtml, formatNumberLocal } from "./utils.js";
import { formatDate, t } from "./i18n.js";
import { resolveImageUrl } from "./photos.js";

// Druckansicht für ausgewählte Rezepte und Produkte.
//
// Die Listenansicht selbst zu drucken wäre unschön: dort stecken Auswahl-
// kästchen, Formularfelder und Bedienelemente drin. Stattdessen wird der
// Inhalt der ausgewählten Einträge in einen eigenen Bereich (#print-area)
// geschrieben, der nur beim Drucken sichtbar ist – aufgebaut aus denselben
// Bausteinen wie der Word-Export, damit Ausdruck und Word-Datei gleich
// aussehen.

const printAreaEl = document.getElementById("print-area");

function printBlocks(title, blocksHtml, withTitle = true) {
  printAreaEl.innerHTML = `${withTitle ? `<h1>${escapeHtml(title)}</h1>` : ""}${blocksHtml}`;
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

export async function printRecipes(recipes) {
  if (recipes.length === 0) return;
  // Aufbaubild fürs Druckblatt vorab auflösen (Word-Export nutzt dieselben
  // Blöcke, aber ohne Bild – siehe buildRecipeBlocks()).
  const withPhotos = await Promise.all(
    recipes.map(async (recipe) => ({
      ...recipe,
      printImageUrl: recipe.imagePath ? await resolveImageUrl(recipe.imagePath) : null,
    }))
  );
  printBlocks(
    recipes.length === 1 ? recipes[0].name : `${t("ui.rezepte_67a4")}${recipes.length})`,
    buildRecipeBlocks(withPhotos)
  );
}

export function printProducts(products) {
  if (products.length === 0) return;
  printBlocks(
    products.length === 1 ? products[0].name : `${t("ui.produkte_5091")}${products.length})`,
    buildProductBlocks(products)
  );
}

// Segmente aus parseInline() (js/knowledge.js) → escaped HTML mit <strong>/<em>.
function inlineHtml(segments) {
  return segments
    .map((seg) => {
      let html = escapeHtml(seg.text).replace(/\n/g, "<br>");
      if (seg.italic) html = `<em>${html}</em>`;
      if (seg.bold) html = `<strong>${html}</strong>`;
      return html;
    })
    .join("");
}

function knowledgeBlockHtml(block) {
  const items = (tag, attrs = "") =>
    `<${tag}${attrs}>${block.items.map((item) => `<li>${inlineHtml(item)}</li>`).join("")}</${tag}>`;
  if (block.type === "ul") return items("ul");
  if (block.type === "ol") return items("ol", block.start !== 1 ? ` start="${Number(block.start)}"` : "");
  if (block.type === "table") {
    const row = (cells, tag) => `<tr>${cells.map((c) => `<${tag}>${inlineHtml(c)}</${tag}>`).join("")}</tr>`;
    return (
      `<table class="knowledge-table">` +
      (block.header ? `<thead>${row(block.header, "th")}</thead>` : "") +
      `<tbody>${block.rows.map((r) => row(r, "td")).join("")}</tbody></table>`
    );
  }
  return `<p>${inlineHtml(block.inline)}</p>`;
}

// Wissensartikel (Paket 54). Der Text kommt aus Nutzereingaben und wird
// deshalb vollständig escaped; die Blöcke stammen aus parseSectionText().
function knowledgeDocHtml(doc) {
  const sections = doc.sections
    .map((section) => {
      const body = section.blocks.map(knowledgeBlockHtml).join("");
      return `${section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : ""}${body}`;
    })
    .join("");
  const sources = doc.sources.length
    ? `<h2>${escapeHtml(doc.sourcesTitle)}</h2><ul>${doc.sources.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`
    : "";
  return (
    `<p class="meta">${escapeHtml([doc.category, doc.departmentsText].filter(Boolean).join(" · "))}</p>` +
    (doc.summary ? `<p><strong>${escapeHtml(doc.summary)}</strong></p>` : "") +
    sections +
    sources +
    (doc.stand ? `<p class="meta">${escapeHtml(doc.stand)}</p>` : "")
  );
}

export function printKnowledge(doc) {
  printBlocks(doc.title, knowledgeDocHtml(doc));
}

// Mehrere Artikel in einem Druckauftrag, jeder auf einer neuen Seite.
export function printKnowledgeMany(docs) {
  if (docs.length === 0) return;
  const html = docs
    .map(
      (doc, i) =>
        `<div${i > 0 ? ' style="break-before:page;page-break-before:always"' : ""}><h1>${escapeHtml(doc.title)}</h1>${knowledgeDocHtml(doc)}</div>`
    )
    .join("");
  printBlocks("", html, false);
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
  return formatDate(value, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function labelHtml(prep, typLabel, ersteller) {
  const zeilen = [
    prep.batchSizeMl ? `${formatNumberLocal(prep.batchSizeMl)} ml` : "",
    prep.abv !== "" && prep.abv != null ? `${formatNumberLocal(prep.abv)} % vol` : "",
    prep.location,
  ].filter(Boolean);

  return `
    <div class="label-card">
      <div class="label-name">${escapeHtml(prep.label)}</div>
      <div class="label-type">${escapeHtml(typLabel)}${zeilen.length ? " · " + escapeHtml(zeilen.join(" · ")) : ""}</div>
      <div class="label-dates">
        <span>${t("ui.angesetzt")}<strong>${formatLabelDate(prep.madeAt)}</strong></span>
        <span>${t("ui.haltbar_bis")}<strong>${formatLabelDate(prep.expiresAt)}</strong></span>
      </div>
      ${prep.notes ? `<div class="label-note">${escapeHtml(prep.notes)}</div>` : ""}
      ${ersteller ? `<div class="label-note">${t("ui.angesetzt_von")} ${escapeHtml(ersteller)}</div>` : ""}
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
  return ml >= 1000 ? `${formatNumberLocal(ml / 1000)} l` : `${formatNumberLocal(ml)} ml`;
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
    ? formatDate(event.eventDate)
    : "–";

  const kopf = [
    [t("ui.datum"), escapeHtml(datum)],
    [t("ui.gaeste"), event.guests ? formatNumberLocal(event.guests) : "–"],
    [t("ui.dauer"), event.durationHours ? `${formatNumberLocal(event.durationHours)} h` : "–"],
    [t("ui.drinks_gesamt"), `${ergebnis.totalDrinks} (inkl. ${formatNumberLocal(Number(event.bufferPercent) || 0)} ${t("ui.puffer_13f0")}`],
    [t("ui.eisbedarf"), `${formatNumberLocal(ergebnis.iceKg)} kg`],
    [t("ui.wareneinsatz"), `${formatNumberLocal(ergebnis.totalCost)} ${t("ui.pro_gast")} ${formatNumberLocal(ergebnis.costPerGuest)} €`],
  ]
    .map(([label, wert]) => `<p class="meta"><strong>${escapeHtml(label)}</strong> ${wert}</p>`)
    .join("");

  const drinks = tabelle(
    [t("ui.rezept"), t("ui.anteil"), t("ui.anzahl"), t("ui.batchmenge"), "ABV"],
    ergebnis.drinks.map((d) => [
      escapeHtml(d.recipeName),
      `${formatNumberLocal(d.share)} %`,
      String(d.count),
      d.found ? formatMengePrint(d.batchMl) : "–",
      d.found && d.abv !== null ? `${formatNumberLocal(d.abv)} % vol` : "–",
    ])
  );

  const entnahme = tabelle(
    [t("ui.zutat"), t("ui.menge"), t("ui.gebinde"), t("ui.lieferant"), t("ui.kosten")],
    ergebnis.volumeLines.map((l) => [
      escapeHtml(l.name),
      formatMengePrint(l.ml),
      l.bottles !== null ? `${l.bottles} × ${formatMengePrint(l.bottleSizeMl)}` : t("ui.gebinde_unbekannt"),
      l.supplier ? escapeHtml(l.supplier) : "–",
      l.priceKnown ? `${formatNumberLocal(l.cost)} €` : t("ui.kein_preis_hinterlegt"),
    ])
  );

  const stueck = tabelle(
    [t("ui.zutat"), t("ui.menge"), t("ui.lieferant")],
    ergebnis.pieceLines.map((l) => [
      escapeHtml(l.name),
      `${formatNumberLocal(Math.ceil(l.amount))} ${escapeHtml(l.unit)}`,
      l.supplier ? escapeHtml(l.supplier) : "–",
    ])
  );

  const notiz = event.notes ? `<p class="meta"><strong>${t("ui.notiz")}</strong> ${escapeHtml(event.notes)}</p>` : "";
  const hinweis =
    ergebnis.missingPrices.length > 0
      ? `<p class="history">${t("ui.ohne_hinterlegten_einkaufspreis_und_7e9c")} ${escapeHtml(
          ergebnis.missingPrices.join(", ")
        )}.</p>`
      : "";

  printBlocks(
    event.name || t("ui.eventplan"),
    `${kopf}${notiz}
     <h2>${t("ui.drinks")}</h2>${drinks}
     <h2>${t("ui.entnahme_einkaufsliste")}</h2>${entnahme || "<p>Keine Volumenzutaten.</p>"}
     ${stueck ? `<h2>${t("ui.stueckzutaten")}</h2>${stueck}` : ""}
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

export function printChecklistRuns(laeufe, titel = t("ui.checklisten_nachweis")) {
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
        [t("ui.punkt"), t("ui.ergebnis"), t("ui.von_kopf"), t("ui.zeitpunkt"), t("ui.notiz")],
        (lauf.zeilen ?? []).map((z) => z.map((c) => escapeHtml(c)))
      );
      const ueberschrift = einzeln ? "" : `<h2>${escapeHtml(lauf.titel)}</h2>`;
      return `${ueberschrift}${kopf}${zeilen || `<p>${t("ui.keine_punkte_in_dieser_vorlage")}</p>`}`;
    })
    .join("");

  printBlocks(laeufe.length === 1 ? laeufe[0].titel : titel, bloecke);
}
