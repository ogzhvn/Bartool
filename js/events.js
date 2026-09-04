import { loadEvents, saveEvent, deleteEvent, onEventsChanged } from "./storage.js";
import { getAllRecipes, getRecipe } from "./recipeLibrary.js";
import { getProduct } from "./productLibrary.js";
import { UNIT_TO_ML, UNIT_LABELS } from "./units.js";
import { priceForIngredient, ingredientCost } from "./costing.js";
import { parseAbv, alcoholMl } from "./abv.js";
import { prefillPreparation } from "./preparations.js";
import { printEventPlan } from "./printView.js";
import { switchTab } from "./tabs.js";
import { isAdmin, getCurrentUser } from "./auth.js";
import { escapeHtml, formatNumberDe } from "./utils.js";

// Event-/Bankettplaner: aus Gästezahl, Dauer und Drinkauswahl fällt hinten
// alles heraus, was für eine Veranstaltung gebraucht wird – Drinkzahl,
// Batchmengen, Entnahmeliste, Wareneinsatz und Eisbedarf.
//
// Die Planungswerte (Drinks pro Gast, Eis pro Drink) sind Faustwerte und
// bleiben frei editierbar: was im Haus realistisch ist, weiß nur der Betrieb.

// Vom Nutzer festgelegter Startwert: 0,35 kg Eis pro Drink.
export const DEFAULT_ICE_KG_PER_DRINK = 0.35;

// Vom Nutzer festgelegter Startwert: 2 Drinks in der ersten Stunde, danach
// 1 weiterer je angefangener Stunde.
export function defaultDrinksPerGuest(durationHours) {
  const stunden = Number(durationHours);
  if (!Number.isFinite(stunden) || stunden <= 0) return 2;
  return 2 + Math.max(0, stunden - 1);
}

// ---------------------------------------------------------------------
// Rechenkern – bewusst ohne DOM-Zugriff, damit er für sich testbar bleibt
// ---------------------------------------------------------------------

const VOLUME_UNITS = new Set(Object.keys(UNIT_TO_ML));

export function totalDrinks({ guests, drinksPerGuest, bufferPercent }) {
  const gaeste = Number(guests) || 0;
  const proGast = Number(drinksPerGuest) || 0;
  const puffer = Number(bufferPercent) || 0;
  return Math.round(gaeste * proGast * (1 + puffer / 100));
}

// Gebindegröße aus dem Freitextfeld "Bestelleinheit". Das Feld ist
// uneinheitlich gepflegt ("0,7 l Flasche", "6 x 0,75 l", "Kiste"), deshalb
// wird nur die letzte Zahl mit Volumeneinheit als Flaschengröße gewertet.
// Findet sich keine, gibt es bewusst keine Flaschenzahl statt einer
// geschätzten – lieber Literangabe plus Hinweis.
export function parseGebindeMl(orderUnit) {
  const text = String(orderUnit ?? "").toLowerCase();
  const treffer = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(ml|cl|l)\b/g)];
  if (treffer.length === 0) return null;
  const [, zahl, einheit] = treffer[treffer.length - 1];
  const wert = Number(zahl.replace(",", "."));
  if (!Number.isFinite(wert) || wert <= 0) return null;
  const faktor = einheit === "ml" ? 1 : einheit === "cl" ? 10 : 1000;
  return wert * faktor;
}

export function formatMenge(ml) {
  return ml >= 1000 ? `${formatNumberDe(ml / 1000)} l` : `${formatNumberDe(ml)} ml`;
}

// Rechnet einen kompletten Eventplan durch.
//
// Volumenzutaten werden über UNIT_TO_ML auf Milliliter normalisiert und je
// Zutatenname zusammengefasst. Stückzutaten (Scheibe, Zweig, Stück) haben
// kein Volumen und landen in einer eigenen Liste – dasselbe Verhalten wie im
// Verdünnungsrechner, damit nichts stillschweigend in ml gepresst wird.
export function planEvent(ev) {
  const drinksGesamt = totalDrinks(ev);
  const mix = Array.isArray(ev.drinkMix) ? ev.drinkMix : [];
  const shareSum = mix.reduce((s, z) => s + (Number(z.share) || 0), 0);

  const volumen = new Map(); // name -> { ml }
  const stueck = new Map(); // name|unit -> { name, unit, amount }
  const drinks = [];
  const fehlendeRezepte = [];

  mix.forEach((zeile) => {
    const anteil = Number(zeile.share) || 0;
    const anzahl = Math.round((drinksGesamt * anteil) / 100);
    const recipe = getRecipe(zeile.recipeName);
    if (!recipe) {
      fehlendeRezepte.push(zeile.recipeName);
      drinks.push({ recipeName: zeile.recipeName, share: anteil, count: anzahl, found: false, batchMl: 0, abv: null, cost: 0 });
      return;
    }

    const basis = Number(recipe.basePortions) || 1;
    const faktor = anzahl / basis;
    let batchMl = 0;
    let kosten = 0;
    const alkoholTeile = [];

    (recipe.ingredients ?? []).forEach((ing) => {
      const menge = (Number(ing.amount) || 0) * faktor;
      const preis = priceForIngredient(ing.name);
      if (VOLUME_UNITS.has(ing.unit)) {
        const ml = menge * (UNIT_TO_ML[ing.unit] ?? 1);
        batchMl += ml;
        volumen.set(ing.name, { ml: (volumen.get(ing.name)?.ml ?? 0) + ml });
        kosten += ingredientCost(ml, "ml", preis ?? 0);
        const produkt = getProduct(ing.name);
        alkoholTeile.push({ amountMl: ml, abv: produkt ? parseAbv(produkt.abv) ?? 0 : 0 });
      } else {
        const key = `${ing.name}|${ing.unit}`;
        const vorher = stueck.get(key);
        stueck.set(key, { name: ing.name, unit: ing.unit, amount: (vorher?.amount ?? 0) + menge });
        kosten += ingredientCost(menge, ing.unit, preis ?? 0);
      }
    });

    const abv = batchMl > 0 ? (alcoholMl(alkoholTeile) / batchMl) * 100 : null;
    drinks.push({
      recipeName: recipe.name,
      share: anteil,
      count: anzahl,
      found: true,
      basePortions: basis,
      factor: faktor,
      batchMl,
      abv,
      cost: kosten,
    });
  });

  // Entnahmeliste: eine Zeile je Zutat, mit Preis, Lieferant und – nur wenn
  // aus der Bestelleinheit wirklich eine Gebindegröße lesbar ist – Flaschenzahl.
  const volumeLines = [...volumen.entries()]
    .map(([name, { ml }]) => {
      const preis = priceForIngredient(name);
      const produkt = getProduct(name);
      const gebindeMl = produkt ? parseGebindeMl(produkt.orderUnit) : null;
      return {
        name,
        ml,
        cost: ingredientCost(ml, "ml", preis ?? 0),
        priceKnown: preis !== null,
        supplier: produkt?.supplier ?? "",
        orderUnit: produkt?.orderUnit ?? "",
        bottleSizeMl: gebindeMl,
        bottles: gebindeMl ? Math.ceil(ml / gebindeMl) : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  const pieceLines = [...stueck.values()]
    .map((z) => {
      const preis = priceForIngredient(z.name);
      const produkt = getProduct(z.name);
      return {
        ...z,
        cost: ingredientCost(z.amount, z.unit, preis ?? 0),
        priceKnown: preis !== null,
        supplier: produkt?.supplier ?? "",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "de"));

  const totalCost = [...volumeLines, ...pieceLines].reduce((s, l) => s + l.cost, 0);
  const gaeste = Number(ev.guests) || 0;
  const eisProDrink = Number(ev.iceKgPerDrink);

  return {
    totalDrinks: drinksGesamt,
    shareSum,
    drinks,
    volumeLines,
    pieceLines,
    totalCost,
    costPerGuest: gaeste > 0 ? totalCost / gaeste : 0,
    iceKg: drinksGesamt * (Number.isFinite(eisProDrink) ? eisProDrink : 0),
    missingPrices: [...volumeLines, ...pieceLines].filter((l) => !l.priceKnown).map((l) => l.name),
    missingRecipes: fehlendeRezepte,
  };
}

// ---------------------------------------------------------------------
// Oberfläche
// ---------------------------------------------------------------------

const formEl = document.getElementById("event-form");
const nameEl = document.getElementById("event-name");
const dateEl = document.getElementById("event-date");
const guestsEl = document.getElementById("event-guests");
const durationEl = document.getElementById("event-duration");
const drinksEl = document.getElementById("event-drinks-per-guest");
const bufferEl = document.getElementById("event-buffer");
const iceEl = document.getElementById("event-ice");
const notesEl = document.getElementById("event-notes");
const mixEl = document.getElementById("event-mix");
const addDrinkBtn = document.getElementById("event-add-drink");
const shareSumEl = document.getElementById("event-share-sum");
const resultEl = document.getElementById("event-result");
const listEl = document.getElementById("event-list");
const submitBtn = document.getElementById("event-submit");
const cancelBtn = document.getElementById("event-cancel");

// Wurde ein Feld von Hand angefasst, überschreibt der Faustwert es nicht mehr.
let drinksTouched = false;

function recipeOptionsHtml(selected) {
  const namen = getAllRecipes().map((r) => r.name);
  if (selected && !namen.includes(selected)) namen.unshift(selected);
  return (
    `<option value="">Rezept wählen …</option>` +
    namen
      .map((n) => `<option value="${escapeHtml(n)}"${n === selected ? " selected" : ""}>${escapeHtml(n)}</option>`)
      .join("")
  );
}

function addMixRow(zeile = {}) {
  const row = document.createElement("div");
  row.className = "ingredient-row event-mix-row";
  row.innerHTML = `
    <select class="event-mix-recipe">${recipeOptionsHtml(zeile.recipeName ?? "")}</select>
    <input type="number" class="event-mix-share" min="0" max="100" step="1" placeholder="Anteil %" value="${
      zeile.share ?? ""
    }" />
    <span class="event-mix-count"></span>
    <button type="button" class="remove-btn" aria-label="Zeile entfernen">×</button>`;
  mixEl.appendChild(row);
}

function readMix() {
  return [...mixEl.querySelectorAll(".event-mix-row")]
    .map((row) => ({
      recipeName: row.querySelector(".event-mix-recipe").value,
      share: row.querySelector(".event-mix-share").value === "" ? 0 : Number(row.querySelector(".event-mix-share").value),
    }))
    .filter((z) => z.recipeName);
}

function readForm() {
  return {
    id: formEl.dataset.editId || "",
    name: nameEl.value.trim(),
    eventDate: dateEl.value || "",
    guests: guestsEl.value,
    durationHours: durationEl.value,
    drinksPerGuest: drinksEl.value,
    bufferPercent: bufferEl.value === "" ? 10 : bufferEl.value,
    iceKgPerDrink: iceEl.value,
    notes: notesEl.value.trim(),
    drinkMix: readMix(),
  };
}

function resetForm() {
  formEl.reset();
  formEl.dataset.editId = "";
  drinksTouched = false;
  bufferEl.value = 10;
  iceEl.value = DEFAULT_ICE_KG_PER_DRINK;
  drinksEl.value = defaultDrinksPerGuest(durationEl.value);
  mixEl.innerHTML = "";
  addMixRow();
  submitBtn.textContent = "Event speichern";
  cancelBtn.hidden = true;
  render();
}

function loadIntoForm(ev) {
  formEl.dataset.editId = ev.id;
  nameEl.value = ev.name ?? "";
  dateEl.value = ev.eventDate ?? "";
  guestsEl.value = ev.guests ?? "";
  durationEl.value = ev.durationHours ?? "";
  drinksEl.value = ev.drinksPerGuest ?? "";
  bufferEl.value = ev.bufferPercent ?? 10;
  iceEl.value = ev.iceKgPerDrink ?? "";
  notesEl.value = ev.notes ?? "";
  drinksTouched = true;
  mixEl.innerHTML = "";
  const mix = Array.isArray(ev.drinkMix) && ev.drinkMix.length > 0 ? ev.drinkMix : [{}];
  mix.forEach(addMixRow);
  submitBtn.textContent = "Änderungen speichern";
  cancelBtn.hidden = false;
  render();
  nameEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function zeileHtml(zellen) {
  return `<tr>${zellen.map((z) => `<td>${z}</td>`).join("")}</tr>`;
}

function ergebnisHtml(ev, plan) {
  if (plan.totalDrinks === 0 || plan.drinks.length === 0) {
    return `<p class="empty-note">Gäste, Drinks pro Gast und mindestens ein Rezept eintragen – dann wird hier gerechnet.</p>`;
  }

  const drinkZeilen = plan.drinks
    .map((d) =>
      zeileHtml([
        escapeHtml(d.recipeName) + (d.found ? "" : ' <em>(Rezept nicht gefunden)</em>'),
        `${formatNumberDe(d.share)} %`,
        `${d.count} Drinks`,
        d.found ? formatMenge(d.batchMl) : "–",
        d.found && d.abv !== null ? `${formatNumberDe(d.abv)} % vol` : "–",
        d.found ? `${formatNumberDe(d.cost)} €` : "–",
      ])
    )
    .join("");

  const entnahmeZeilen = plan.volumeLines
    .map((l) =>
      zeileHtml([
        escapeHtml(l.name),
        formatMenge(l.ml),
        l.bottles !== null
          ? `${l.bottles} × ${formatMenge(l.bottleSizeMl)}`
          : '<span style="color: var(--danger)">Gebinde unbekannt</span>',
        l.supplier ? escapeHtml(l.supplier) : "–",
        l.priceKnown ? `${formatNumberDe(l.cost)} €` : '<span style="color: var(--danger)">kein Preis hinterlegt</span>',
      ])
    )
    .join("");

  const stueckZeilen = plan.pieceLines
    .map((l) =>
      zeileHtml([
        escapeHtml(l.name),
        `${formatNumberDe(Math.ceil(l.amount))} ${escapeHtml(UNIT_LABELS[l.unit] ?? l.unit)}`,
        l.supplier ? escapeHtml(l.supplier) : "–",
        l.priceKnown ? `${formatNumberDe(l.cost)} €` : '<span style="color: var(--danger)">kein Preis hinterlegt</span>',
      ])
    )
    .join("");

  const hinweise = [];
  if (plan.missingRecipes.length > 0) {
    hinweise.push(
      `Nicht im Rezeptbuch gefunden und deshalb nicht eingerechnet: ${escapeHtml(plan.missingRecipes.join(", "))}.`
    );
  }
  if (plan.missingPrices.length > 0) {
    hinweise.push(
      `Ohne Einkaufspreis im Katalog und deshalb mit 0 € in der Summe: ${escapeHtml(
        plan.missingPrices.join(", ")
      )}. Der Wareneinsatz ist damit zu niedrig.`
    );
  }

  return `
    <div class="result-box">
      <p><strong>Drinks gesamt</strong> ${plan.totalDrinks} (inkl. ${formatNumberDe(
        Number(ev.bufferPercent) || 0
      )} % Puffer)</p>
      <p><strong>Wareneinsatz</strong> ${formatNumberDe(plan.totalCost)} € · pro Gast ${formatNumberDe(
        plan.costPerGuest
      )} €</p>
      <p><strong>Eisbedarf</strong> ${formatNumberDe(plan.iceKg)} kg</p>
      ${hinweise.map((h) => `<p style="color: var(--danger)">${h}</p>`).join("")}

      <h4>Drinks</h4>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Rezept</th><th>Anteil</th><th>Anzahl</th><th>Batchmenge</th><th>ABV</th><th>Kosten</th></tr></thead>
          <tbody>${drinkZeilen}</tbody>
        </table>
      </div>

      <h4>Entnahme-/Einkaufsliste</h4>
      ${
        entnahmeZeilen
          ? `<div class="table-scroll"><table>
              <thead><tr><th>Zutat</th><th>Menge</th><th>Gebinde</th><th>Lieferant</th><th>Kosten</th></tr></thead>
              <tbody>${entnahmeZeilen}</tbody>
            </table></div>`
          : '<p class="empty-note">Keine Volumenzutaten.</p>'
      }

      ${
        stueckZeilen
          ? `<h4>Stückzutaten</h4>
             <div class="table-scroll"><table>
               <thead><tr><th>Zutat</th><th>Menge</th><th>Lieferant</th><th>Kosten</th></tr></thead>
               <tbody>${stueckZeilen}</tbody>
             </table></div>`
          : ""
      }

      <div class="actions no-print">
        <button type="button" id="event-to-preps" class="btn-secondary">Batches als Ansätze anlegen</button>
        <button type="button" id="event-print" class="btn-secondary">Plan drucken</button>
      </div>
    </div>`;
}

function render() {
  const ev = readForm();
  const plan = planEvent(ev);

  // Anzahl je Rezept direkt an der Zeile anzeigen
  [...mixEl.querySelectorAll(".event-mix-row")].forEach((row) => {
    const name = row.querySelector(".event-mix-recipe").value;
    const treffer = plan.drinks.find((d) => d.recipeName === name);
    row.querySelector(".event-mix-count").textContent = treffer ? `${treffer.count} Drinks` : "";
  });

  if (plan.drinks.length === 0) {
    shareSumEl.textContent = "Noch kein Rezept gewählt.";
    shareSumEl.style.color = "";
  } else if (Math.round(plan.shareSum) !== 100) {
    shareSumEl.textContent = `Summe der Anteile: ${formatNumberDe(plan.shareSum)} % – sollte 100 % sein.`;
    shareSumEl.style.color = "var(--danger)";
  } else {
    shareSumEl.textContent = "Summe der Anteile: 100 %.";
    shareSumEl.style.color = "";
  }

  resultEl.innerHTML = ergebnisHtml(ev, plan);
  resultEl.querySelector("#event-to-preps")?.addEventListener("click", () => uebernehmeAlsAnsaetze(ev, plan));
  resultEl.querySelector("#event-print")?.addEventListener("click", () => printEventPlan(ev, plan));
}

// Legt den ersten Batch im Mise en Place vor und springt dorthin. Bewusst
// einer nach dem anderen: das Ansatz-Formular nimmt genau einen Eintrag auf,
// und jede Charge will ohnehin einzeln bestätigt werden.
function uebernehmeAlsAnsaetze(ev, plan) {
  const batches = plan.drinks.filter((d) => d.found && d.batchMl > 0);
  if (batches.length === 0) {
    alert("Kein Rezept mit Batchmenge – bitte zuerst Rezepte und Anteile eintragen.");
    return;
  }
  const offen = batches.slice(1).map((d) => d.recipeName);
  const erster = batches[0];
  prefillPreparation({
    label: `${erster.recipeName} – ${ev.name || "Event"}`,
    // Vorbelegung: alles mit Alkohol als Batch, sonst Sonstiges. Die Art
    // steuert die Haltbarkeit und gehört im Formular geprüft (Frischsaft!).
    prepType: erster.abv && erster.abv > 0 ? "batch" : "sonstiges",
    batchSizeMl: Math.round(erster.batchMl),
    abv: erster.abv !== null ? Number(erster.abv.toFixed(1)) : "",
    recipeName: erster.recipeName,
  });
  switchTab("preparations");
  if (offen.length > 0) {
    alert(
      `„${erster.recipeName}" ist im Mise en Place vorbelegt. Nach dem Speichern hier zurückkommen für: ${offen.join(", ")}.`
    );
  }
}

function eventHtml(ev) {
  const datum = ev.eventDate
    ? new Date(ev.eventDate).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "ohne Datum";
  const details = [
    datum,
    ev.guests ? `${formatNumberDe(ev.guests)} Gäste` : "",
    ev.durationHours ? `${formatNumberDe(ev.durationHours)} h` : "",
    `${(ev.drinkMix ?? []).length} Rezept(e)`,
  ].filter(Boolean);

  return `
    <div class="prep-item" data-id="${escapeHtml(ev.id)}">
      <div class="prep-item-head">
        <strong>${escapeHtml(ev.name)}</strong>
        <span class="prep-status">${escapeHtml(datum)}</span>
      </div>
      <div class="prep-meta">${escapeHtml(details.join(" · "))}</div>
      <div class="actions no-print">
        <button type="button" class="btn-secondary event-open">Laden</button>
        ${isAdmin() ? '<button type="button" class="btn-secondary event-delete">Löschen</button>' : ""}
      </div>
    </div>`;
}

// Kommende zuerst, danach vergangene (die neuesten oben), Events ohne Datum
// ganz zum Schluss.
function sortiereEvents(events) {
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  const wert = (ev) => (ev.eventDate ? new Date(ev.eventDate).getTime() : null);
  const kommend = events.filter((e) => wert(e) !== null && wert(e) >= heute.getTime()).sort((a, b) => wert(a) - wert(b));
  const vergangen = events.filter((e) => wert(e) !== null && wert(e) < heute.getTime()).sort((a, b) => wert(b) - wert(a));
  const ohne = events.filter((e) => wert(e) === null).sort((a, b) => a.name.localeCompare(b.name, "de"));
  return [...kommend, ...vergangen, ...ohne];
}

function renderList() {
  const events = sortiereEvents(loadEvents());
  listEl.innerHTML = events.length
    ? events.map(eventHtml).join("")
    : '<p class="empty-note">Noch keine Events gespeichert.</p>';
}

async function handleSubmit(e) {
  e.preventDefault();
  const ev = readForm();
  if (!ev.name) {
    alert("Bitte einen Namen für die Veranstaltung eintragen.");
    return;
  }
  const nutzer = getCurrentUser();
  if (nutzer && !ev.id) ev.createdBy = nutzer.id;
  try {
    await saveEvent(ev);
    resetForm();
  } catch (err) {
    alert("Speichern fehlgeschlagen: " + err.message);
  }
}

export function initEvents() {
  resetForm();
  renderList();
  onEventsChanged(renderList);

  formEl.addEventListener("submit", handleSubmit);
  cancelBtn.addEventListener("click", resetForm);
  addDrinkBtn.addEventListener("click", () => {
    addMixRow();
    render();
  });

  drinksEl.addEventListener("input", () => {
    drinksTouched = true;
  });
  durationEl.addEventListener("input", () => {
    if (!drinksTouched) drinksEl.value = defaultDrinksPerGuest(durationEl.value);
  });

  formEl.addEventListener("input", render);
  formEl.addEventListener("change", render);

  mixEl.addEventListener("click", (e) => {
    if (!e.target.closest(".remove-btn")) return;
    const zeilen = mixEl.querySelectorAll(".event-mix-row");
    if (zeilen.length > 1) e.target.closest(".event-mix-row").remove();
    else zeilen[0].querySelector(".event-mix-share").value = "";
    render();
  });

  listEl.addEventListener("click", async (e) => {
    const box = e.target.closest(".prep-item");
    if (!box) return;
    const ev = loadEvents().find((x) => x.id === box.dataset.id);
    if (!ev) return;
    if (e.target.closest(".event-open")) loadIntoForm(ev);
    else if (e.target.closest(".event-delete")) {
      if (!confirm(`Event „${ev.name}" wirklich löschen?`)) return;
      try {
        await deleteEvent(ev.id);
      } catch (err) {
        alert("Löschen fehlgeschlagen: " + err.message);
      }
    }
  });
}
