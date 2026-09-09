import { loadLosses, saveLoss, deleteLoss, onLossesChanged } from "./storage.js";
import { getAllProducts, getProduct } from "./productLibrary.js";
import { onProductsChanged } from "./storage.js";
import { ingredientCost } from "./costing.js";
import { isAdmin, getCurrentUser } from "./auth.js";
import { escapeHtml, formatNumberDe } from "./utils.js";

// Schwund-, Bruch- und Verkostungsbuch.
//
// Ziel: jeder Milliliter, der nicht über den Tresen verkauft wurde, bekommt
// einen Grund. Damit ist die Inventurdifferenz erklärbar statt geschätzt.
//
// Zwei Dinge werden hier bewusst nicht geraten:
// – Ein Produkt ohne hinterlegten Einkaufspreis erzeugt keinen 0-€-Wert,
//   sondern einen sichtbaren Hinweis. 0 € wäre eine Behauptung.
// – "Flasche" und "Glas" sind keine Mengen, solange niemand die Größe sagt.
//   Der Katalog kennt keine Flaschengröße, deshalb fragt das Formular danach.
//   Ohne Angabe wird die Buchung gespeichert, aber nicht bewertet.

export const GRUENDE = ["Bruch", "Verkostung Gast", "Schulung", "Retoure/verdorben", "Schwund unklar"];

export const EINHEITEN = ["ml", "cl", "Flasche", "Glas"];

// Wie weit die Liste zurückreicht.
const SICHTBARE_TAGE = 30;

// ---------------------------------------------------------------------
// Logik – ohne DOM-Zugriff, damit sie für sich prüfbar bleibt
// ---------------------------------------------------------------------

// Milliliter einer Buchung, sofern ableitbar. "Flasche" und "Glas" sind es
// nicht: ohne Größenangabe wäre jede Zahl erfunden.
export function mengeInMl(loss) {
  const menge = Number(loss?.amount);
  if (!Number.isFinite(menge)) return null;
  if (loss.amountUnit === "ml") return menge;
  if (loss.amountUnit === "cl") return menge * 10;
  return null;
}

// Wert einer einzelnen Buchung. Gibt entweder einen Betrag oder einen Grund
// zurück, warum es keinen gibt – nie beides und nie stillschweigend 0 €.
export function wertEintrag(loss, produkt) {
  if (!produkt) return { wert: null, hinweis: "kein Produkt aus dem Katalog zugeordnet" };
  const preis = produkt.priceValue;
  if (preis === "" || preis == null) return { wert: null, hinweis: "kein Einkaufspreis hinterlegt" };
  const menge = Number(loss?.amount);
  if (!Number.isFinite(menge)) return { wert: null, hinweis: "keine gültige Menge" };

  if (produkt.priceUnit === "liter") {
    const ml = mengeInMl(loss);
    if (ml === null)
      return { wert: null, hinweis: `Preis ist je Liter hinterlegt – für „${loss.amountUnit}“ fehlt die Größe in ml` };
    return { wert: ingredientCost(ml, "ml", Number(preis)), hinweis: null };
  }

  // Preis je Stück: eine ganze Flasche ist ein Stück, eine Teilmenge nicht.
  if (loss.amountUnit === "Flasche") return { wert: ingredientCost(menge, "stk", Number(preis)), hinweis: null };
  return { wert: null, hinweis: "Preis ist je Stück hinterlegt – Teilmengen lassen sich so nicht bewerten" };
}

function zeitwert(iso) {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
}

// Buchungen der letzten 30 Tage, neueste zuerst.
export function sichtbareVerluste(losses, jetzt = new Date()) {
  const grenze = jetzt.getTime() - SICHTBARE_TAGE * 86400000;
  return [...losses]
    .filter((l) => (zeitwert(l.occurredAt) ?? 0) >= grenze)
    .sort((a, b) => (zeitwert(b.occurredAt) ?? 0) - (zeitwert(a.occurredAt) ?? 0));
}

// Summe je Grund. Buchungen ohne berechenbaren Wert werden mitgezählt, aber
// nicht mit 0 € einsummiert – sonst sähe die Summe vollständiger aus als sie ist.
export function summeJeGrund(losses) {
  const produkte = getAllProducts();
  const nachGrund = new Map();
  losses.forEach((l) => {
    const produkt = produkte.find((p) => p.name === l.productName) ?? null;
    const { wert } = wertEintrag(l, produkt);
    const bisher = nachGrund.get(l.reason) ?? { wert: 0, anzahl: 0, ohneWert: 0 };
    bisher.anzahl += 1;
    if (wert === null) bisher.ohneWert += 1;
    else bisher.wert += wert;
    nachGrund.set(l.reason, bisher);
  });
  return [...nachGrund.entries()].sort((a, b) => b[1].wert - a[1].wert);
}

// Gebuchte Verluste je Produkt in einem Zeitraum – die Grundlage für
// „davon erklärt" in der Inventur-Auswertung.
//
// vonDatum/bisDatum sind Zähldaten (YYYY-MM-DD). Gezählt wird vom Beginn des
// Tages der Vorzählung bis zum Ende des Tages der aktuellen Zählung.
// ml und Stück bleiben getrennt: ein Produkt wird entweder nach Volumen oder
// nach Stück geführt, und beides zu vermischen wäre eine Erfindung.
export function verlusteImZeitraum(vonDatum, bisDatum, losses = loadLosses()) {
  if (!vonDatum || !bisDatum) return null;
  const von = new Date(vonDatum);
  von.setHours(0, 0, 0, 0);
  const bis = new Date(bisDatum);
  bis.setHours(23, 59, 59, 999);

  const jeProdukt = new Map();
  losses.forEach((l) => {
    const t = zeitwert(l.occurredAt);
    if (t === null || t < von.getTime() || t > bis.getTime()) return;
    const eintrag = jeProdukt.get(l.productName) ?? { ml: 0, stueck: 0, unklar: 0, anzahl: 0 };
    eintrag.anzahl += 1;
    const ml = mengeInMl(l);
    const menge = Number(l.amount);
    if (ml !== null) eintrag.ml += ml;
    else if (l.amountUnit === "Flasche" && Number.isFinite(menge)) eintrag.stueck += menge;
    else eintrag.unklar += 1;
    jeProdukt.set(l.productName, eintrag);
  });
  return jeProdukt;
}

// ---------------------------------------------------------------------
// Oberfläche
// ---------------------------------------------------------------------

const reasonsEl = document.getElementById("loss-reasons");
const formEl = document.getElementById("loss-form");
const productEl = document.getElementById("loss-product");
const productOptionsEl = document.getElementById("loss-product-options");
const productWarnEl = document.getElementById("loss-product-warning");
const amountEl = document.getElementById("loss-amount");
const unitEl = document.getElementById("loss-unit");
const sizeWrapEl = document.getElementById("loss-size-wrap");
const sizeEl = document.getElementById("loss-size");
const dateEl = document.getElementById("loss-date");
const noteEl = document.getElementById("loss-note");
const previewEl = document.getElementById("loss-value-preview");
const filterReasonEl = document.getElementById("loss-filter-reason");
const filterProductEl = document.getElementById("loss-filter-product");
const summaryEl = document.getElementById("loss-summary");
const listEl = document.getElementById("loss-list");

let gewaehlterGrund = GRUENDE[0];

function heuteInput(jetzt = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${jetzt.getFullYear()}-${p(jetzt.getMonth() + 1)}-${p(jetzt.getDate())}`;
}

function formatZeitpunkt(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatEuro(n) {
  return `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

// Ein am Tag gebuchter Verlust bekommt die aktuelle Uhrzeit, ein
// nachgetragener die Tagesmitte – damit er beim Zeitraumvergleich sicher
// innerhalb seines Tages liegt, egal in welcher Zeitzone gerechnet wird.
function zeitpunktAusDatum(datum) {
  if (!datum) return new Date().toISOString();
  if (datum === heuteInput()) return new Date().toISOString();
  const d = new Date(datum);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

// ── Formular ──────────────────────────────────────────────────────────

function renderGruende() {
  reasonsEl.innerHTML = GRUENDE.map(
    (g) =>
      `<button type="button" class="loss-reason-btn${g === gewaehlterGrund ? " active" : ""}" data-reason="${escapeHtml(
        g
      )}" aria-pressed="${g === gewaehlterGrund}">${escapeHtml(g)}</button>`
  ).join("");
}

function renderProduktListe() {
  productOptionsEl.innerHTML = getAllProducts()
    .map((p) => `<option value="${escapeHtml(p.name)}"></option>`)
    .join("");
}

// Der Katalogtreffer ist ein exakter Namensvergleich. Alles andere wäre
// Ratespiel: das Zutaten-Matching im Tool ist ein strikter Teilstring-
// Vergleich, ein danebenliegender Freitext bliebe still ohne Zuordnung.
function gewaehltesProdukt() {
  const name = productEl.value.trim();
  if (!name) return null;
  return getProduct(name);
}

function entwurf() {
  const menge = Number(amountEl.value);
  const einheit = unitEl.value;
  const groesse = Number(sizeEl.value);
  // Flasche/Glas mit Größenangabe wird in ml gebucht – nur so lässt sich der
  // Verlust später bewerten und gegen die Inventur rechnen.
  if ((einheit === "Flasche" || einheit === "Glas") && Number.isFinite(groesse) && groesse > 0) {
    return { amount: menge * groesse, amountUnit: "ml" };
  }
  return { amount: menge, amountUnit: einheit };
}

function aktualisiereVorschau() {
  const name = productEl.value.trim();
  const produkt = gewaehltesProdukt();
  const freitext = Boolean(name) && !produkt;
  productWarnEl.hidden = !freitext;
  productWarnEl.textContent = freitext
    ? "Kein Produkt mit diesem Namen im Katalog. Die Buchung wird gespeichert, lässt sich aber weder bewerten noch der Inventur zuordnen. Besser aus der Vorschlagsliste wählen."
    : "";

  const brauchtGroesse = unitEl.value === "Flasche" || unitEl.value === "Glas";
  sizeWrapEl.hidden = !brauchtGroesse;

  const menge = Number(amountEl.value);
  if (!Number.isFinite(menge) || menge <= 0) {
    previewEl.textContent = "";
    return;
  }
  const { wert, hinweis } = wertEintrag({ ...entwurf() }, produkt);
  previewEl.textContent = wert === null ? `Kein Wert: ${hinweis}.` : `Wert: ${formatEuro(wert)}`;
}

async function handleSubmit(e) {
  e.preventDefault();
  const name = productEl.value.trim();
  const menge = Number(amountEl.value);
  if (!name) {
    alert("Bitte ein Produkt angeben.");
    return;
  }
  if (!Number.isFinite(menge) || menge <= 0) {
    alert("Bitte eine Menge größer als 0 eintragen.");
    return;
  }
  const nutzer = getCurrentUser();
  if (!nutzer) {
    alert("Nicht angemeldet – die Buchung braucht einen Autor.");
    return;
  }
  const { amount, amountUnit } = entwurf();
  try {
    await saveLoss({
      productName: name,
      amount,
      amountUnit,
      reason: gewaehlterGrund,
      note: noteEl.value.trim(),
      recordedBy: nutzer.id,
      occurredAt: zeitpunktAusDatum(dateEl.value),
    });
    // Grund und Datum bleiben stehen: nach einem Bruch kommt oft der nächste.
    productEl.value = "";
    amountEl.value = "";
    sizeEl.value = "";
    noteEl.value = "";
    aktualisiereVorschau();
    productEl.focus();
  } catch (err) {
    alert("Buchen fehlgeschlagen: " + err.message);
  }
}

// ── Liste ─────────────────────────────────────────────────────────────

function gefilterte() {
  const grund = filterReasonEl.value;
  const suche = filterProductEl.value.trim().toLowerCase();
  return sichtbareVerluste(loadLosses()).filter(
    (l) =>
      (!grund || l.reason === grund) && (!suche || String(l.productName).toLowerCase().includes(suche))
  );
}

function mengeText(loss) {
  return `${formatNumberDe(Number(loss.amount))} ${loss.amountUnit}`;
}

function eintragHtml(loss, produkt, darfLoeschen) {
  const { wert, hinweis } = wertEintrag(loss, produkt);
  const wertText = wert === null ? hinweis : formatEuro(wert);
  return `
    <div class="prep-item" data-id="${escapeHtml(loss.id)}">
      <div class="prep-item-head">
        <strong>${escapeHtml(loss.productName)}</strong>
        <span class="prep-status">${escapeHtml(wertText)}</span>
      </div>
      <p class="prep-meta">${escapeHtml(mengeText(loss))} · ${escapeHtml(loss.reason)} · ${escapeHtml(
        formatZeitpunkt(loss.occurredAt)
      )}</p>
      ${loss.note ? `<p class="prep-meta">${escapeHtml(loss.note)}</p>` : ""}
      ${
        darfLoeschen
          ? '<div class="actions no-print"><button type="button" class="btn-secondary loss-delete">Löschen</button></div>'
          : ""
      }
    </div>`;
}

function renderSummary(losses) {
  if (losses.length === 0) {
    summaryEl.innerHTML = "";
    return;
  }
  const zeilen = summeJeGrund(losses);
  const gesamt = zeilen.reduce((s, [, d]) => s + d.wert, 0);
  const ohneWert = zeilen.reduce((s, [, d]) => s + d.ohneWert, 0);
  summaryEl.innerHTML = `
    <div class="table-scroll">
      <table>
        <thead><tr><th>Grund</th><th>Buchungen</th><th>Wert</th></tr></thead>
        <tbody>
          ${zeilen
            .map(
              ([grund, d]) =>
                `<tr><td>${escapeHtml(grund)}</td><td>${d.anzahl}</td><td>${formatEuro(d.wert)}${
                  d.ohneWert > 0 ? ` <span class="prep-status">(${d.ohneWert} ohne Wert)</span>` : ""
                }</td></tr>`
            )
            .join("")}
        </tbody>
        <tfoot><tr><th>Summe</th><th>${losses.length}</th><th>${formatEuro(gesamt)}</th></tr></tfoot>
      </table>
    </div>
    ${
      ohneWert > 0
        ? `<p class="empty-note">${ohneWert} Buchung(en) ohne Wert – fehlender Einkaufspreis oder eine Menge, die sich nicht umrechnen lässt. Diese fehlen in der Summe.</p>`
        : ""
    }`;
}

function renderList() {
  const losses = gefilterte();
  const produkte = getAllProducts();
  const nutzer = getCurrentUser();
  const admin = isAdmin();
  renderSummary(losses);
  listEl.innerHTML = losses.length
    ? losses
        .map((l) =>
          eintragHtml(
            l,
            produkte.find((p) => p.name === l.productName) ?? null,
            admin || (nutzer && l.recordedBy === nutzer.id)
          )
        )
        .join("")
    : '<p class="empty-note">Keine Buchungen in den letzten 30 Tagen.</p>';
}

function renderFilter() {
  const gewaehlt = filterReasonEl.value;
  filterReasonEl.innerHTML =
    '<option value="">Alle Gründe</option>' +
    GRUENDE.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  filterReasonEl.value = gewaehlt;
}

export function initLosses() {
  renderGruende();
  renderProduktListe();
  renderFilter();
  unitEl.innerHTML = EINHEITEN.map((e) => `<option value="${e}">${e}</option>`).join("");
  dateEl.value = heuteInput();
  aktualisiereVorschau();
  renderList();

  onLossesChanged(renderList);
  onProductsChanged(() => {
    renderProduktListe();
    aktualisiereVorschau();
    renderList();
  });

  reasonsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".loss-reason-btn");
    if (!btn) return;
    gewaehlterGrund = btn.dataset.reason;
    renderGruende();
  });

  formEl.addEventListener("submit", handleSubmit);
  [productEl, amountEl, unitEl, sizeEl].forEach((el) => {
    el.addEventListener("input", aktualisiereVorschau);
    el.addEventListener("change", aktualisiereVorschau);
  });

  filterReasonEl.addEventListener("change", renderList);
  filterProductEl.addEventListener("input", renderList);

  listEl.addEventListener("click", async (e) => {
    if (!e.target.closest(".loss-delete")) return;
    const karte = e.target.closest(".prep-item");
    const loss = loadLosses().find((l) => l.id === karte?.dataset.id);
    if (!loss) return;
    if (!confirm(`Buchung „${loss.productName}“ (${mengeText(loss)}) wirklich löschen?`)) return;
    try {
      await deleteLoss(loss.id);
    } catch (err) {
      alert("Löschen fehlgeschlagen: " + err.message);
    }
  });
}
