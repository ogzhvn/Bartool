import { getAllProducts } from "./productLibrary.js";
import { ingredientCost } from "./costing.js";
import { escapeHtml, formatNumberLocal } from "./utils.js";
import { getLocale, t } from "./i18n.js";

// Auswertung einer Zählung und Bestellvorschlag.
//
// Zwei Fragen: Was ist der Bestand wert, und was muss nachbestellt werden.
// Beides nur so gut wie die gepflegten Daten – fehlende Preise und
// Soll-Bestände werden deshalb ausgewiesen statt als 0 durchgerechnet.

export function formatEuro(n) {
  return `${n.toLocaleString(getLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

// Wert einer gezählten Menge. Die Preiseinheit entscheidet, wie gerechnet
// wird: bei "€ / Liter" ist die gezählte Menge in Litern zu verstehen,
// bei "€ / Stück" in Stück.
function positionsWert(produkt, menge) {
  const preis = produkt.priceValue;
  if (preis === "" || preis == null || menge == null) return null;
  const einheit = produkt.priceUnit === "liter" ? "ml" : "stk";
  const anzahl = einheit === "ml" ? menge * 1000 : menge;
  return ingredientCost(anzahl, einheit, Number(preis));
}

// stand: { produktname: { quantity, unit } }
export function auswertung(stand) {
  const produkte = getAllProducts();
  const zeilen = [];
  let gesamtwert = 0;
  let ohnePreis = 0;

  produkte.forEach((p) => {
    const menge = stand[p.name]?.quantity;
    if (menge === null || menge === undefined) return; // nicht gezählt
    const wert = positionsWert(p, menge);
    if (wert === null) ohnePreis += 1;
    else gesamtwert += wert;
    zeilen.push({
      name: p.name,
      gruppe: p.group || p.category || t("ui.ohne_kategorie"),
      menge,
      einheit: p.priceUnit === "liter" ? "l" : "Stk",
      wert,
    });
  });

  // Wert je Kategorie, absteigend – zeigt, wo das Kapital liegt.
  const nachGruppe = new Map();
  zeilen.forEach((z) => {
    const bisher = nachGruppe.get(z.gruppe) ?? { wert: 0, positionen: 0 };
    bisher.wert += z.wert ?? 0;
    bisher.positionen += 1;
    nachGruppe.set(z.gruppe, bisher);
  });

  return {
    zeilen: zeilen.sort((a, b) => a.name.localeCompare(b.name, getLocale())),
    gesamtwert,
    ohnePreis,
    gezaehlt: zeilen.length,
    gesamtProdukte: produkte.length,
    gruppen: [...nachGruppe.entries()].sort((a, b) => b[1].wert - a[1].wert),
  };
}

// Differenz zu einer früheren Zählung. Nur Produkte, die in beiden gezählt
// wurden – alles andere wäre kein Vergleich, sondern eine Lücke.
export function differenz(stand, vorher) {
  if (!vorher) return null;
  const zeilen = [];
  Object.entries(stand).forEach(([name, eintrag]) => {
    const jetzt = eintrag?.quantity;
    const alt = vorher[name]?.quantity;
    if (jetzt === null || jetzt === undefined || alt === null || alt === undefined) return;
    if (jetzt === alt) return;
    zeilen.push({ name, alt, jetzt, delta: jetzt - alt });
  });
  return zeilen.sort((a, b) => a.delta - b.delta);
}

// Bestellvorschlag: Soll-Bestand minus gezählte Menge, gruppiert nach
// Lieferant. Produkte ohne Soll-Bestand werden nicht geschätzt, sondern
// gesondert ausgewiesen.
export function bestellvorschlag(stand) {
  const nachLieferant = new Map();
  const ohneParLevel = [];

  getAllProducts().forEach((p) => {
    const menge = stand[p.name]?.quantity;
    if (menge === null || menge === undefined) return; // nicht gezählt
    const soll = p.parLevel;
    if (soll === "" || soll == null) {
      ohneParLevel.push(p.name);
      return;
    }
    const fehlt = Number(soll) - menge;
    if (fehlt <= 0) return;
    const lieferant = p.supplier || t("ui.ohne_lieferant");
    if (!nachLieferant.has(lieferant)) nachLieferant.set(lieferant, []);
    nachLieferant.get(lieferant).push({
      name: p.name,
      bestand: menge,
      soll: Number(soll),
      menge: fehlt,
      einheit: p.orderUnit || "",
    });
  });

  return {
    lieferanten: [...nachLieferant.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], getLocale()))
      .map(([name, positionen]) => ({
        name,
        positionen: positionen.sort((a, b) => a.name.localeCompare(b.name, getLocale())),
      })),
    ohneParLevel: ohneParLevel.sort((a, b) => a.localeCompare(b, getLocale())),
  };
}

// Wie viel der Differenz durch gebuchte Verluste erklärt ist – in der
// Einheit, in der auch gezählt wurde: Liter bei Produkten mit Literpreis,
// Stück bei allen anderen. Verluste in einer nicht umrechenbaren Einheit
// werden gezählt, aber nicht heimlich mitgerechnet.
function erklaerteMenge(name, erklaert, produkte) {
  if (!erklaert) return null;
  const e = erklaert.get(name);
  if (!e) return null;
  const produkt = produkte.find((p) => p.name === name);
  const proLiter = !produkt || produkt.priceUnit === "liter";
  const menge = proLiter ? e.ml / 1000 : e.stueck;
  const nichtGerechnet = e.unklar + (proLiter ? (e.stueck > 0 ? 1 : 0) : e.ml > 0 ? 1 : 0);
  return { menge, nichtGerechnet };
}

export function renderAuswertungHtml(a, diff, erklaert = null) {
  const gruppenZeilen = a.gruppen
    .map(
      ([gruppe, d]) =>
        `<tr><td>${escapeHtml(gruppe)}</td><td>${d.positionen}</td><td>${formatEuro(d.wert)}</td></tr>`
    )
    .join("");

  const produkte = getAllProducts();
  const diffZeile = (d) => {
    const e = erklaerteMenge(d.name, erklaert, produkte);
    const erklaertZelle = !erklaert
      ? ""
      : e === null
        ? "<td>–</td><td>–</td>"
        : `<td>${formatNumberDe(Number(e.menge.toFixed(2)))}${
            e.nichtGerechnet > 0 ? ` <span class="prep-status">(${e.nichtGerechnet} ${t("ui.ohne_menge")}</span>` : ""
          }</td><td>${
            d.delta < 0 ? formatNumberDe(Number(Math.min(0, d.delta + e.menge).toFixed(2))) : "–"
          }</td>`;
    return `<tr><td>${escapeHtml(d.name)}</td><td>${formatNumberDe(d.alt)}</td><td>${formatNumberDe(d.jetzt)}</td><td class="${d.delta < 0 ? "menu-quote-high" : "menu-quote-ok"}">${d.delta > 0 ? "+" : ""}${formatNumberDe(d.delta)}</td>${erklaertZelle}</tr>`;
  };

  const diffBlock =
    diff && diff.length > 0
      ? `
      <h4 class="prep-group">${t("ui.veraenderung_zur_letzten_zaehlung")}${diff.length})</h4>
      ${
        erklaert
          ? `<p class="prep-meta">${t("ui.davon_erklaert_sind_die_verluste_4d1e")}</p>`
          : `<p class="prep-meta">${t("ui.ohne_fruehere_zaehlung_gibt_es_keinen_9c3a")}</p>`
      }
      <div class="table-scroll">
        <table>
          <thead><tr><th>${t("ui.produkt")}</th><th>${t("ui.vorher_klein")}</th><th>${t("ui.jetzt")}</th><th>${t("ui.differenz")}</th>${
            erklaert ? `<th>${t("ui.davon_erklaert")}</th><th>${t("ui.ungeklaert")}</th>` : ""
          }</tr></thead>
          <tbody>
            ${diff.map(diffZeile).join("")}
          </tbody>
        </table>
      </div>`
      : diff
        ? `<p class="empty-note">${t("ui.keine_veraenderung_gegenueber_der_letzten_f9fa")}</p>`
        : `<p class="empty-note">${t("ui.keine_fruehere_abgeschlossene_zaehlung_zum_bffa")}</p>`;

  return `
    <div class="home-stats">
      <div class="stat-tile"><span class="stat-value">${formatEuro(a.gesamtwert)}</span><span class="stat-label">${t("ui.bestandswert")}</span></div>
      <div class="stat-tile"><span class="stat-value">${a.gezaehlt}</span><span class="stat-label">${t("ui.gezaehlte_positionen")}</span></div>
      <div class="stat-tile"><span class="stat-value">${a.gesamtProdukte - a.gezaehlt}</span><span class="stat-label">${t("ui.nicht_gezaehlt")}</span></div>
    </div>
    ${
      a.ohnePreis > 0
        ? `<p class="empty-note">${a.ohnePreis} ${t("ui.gezaehlte_position_en_ohne_einkaufspreis_ec0c")}</p>`
        : ""
    }
    <h4 class="prep-group">${t("ui.wert_nach_kategorie")}</h4>
    <div class="table-scroll">
      <table>
        <thead><tr><th>${t("ui.kategorie")}</th><th>${t("ui.positionen")}</th><th>${t("ui.wert")}</th></tr></thead>
        <tbody>${gruppenZeilen}</tbody>
      </table>
    </div>
    ${diffBlock}`;
}

export function renderBestellvorschlagHtml(v) {
  if (v.lieferanten.length === 0 && v.ohneParLevel.length === 0) {
    return `<p class="empty-note">${t("ui.nichts_nachzubestellen_oder_es_sind_noch_077b")}</p>`;
  }

  const bloecke = v.lieferanten
    .map(
      (l) => `
      <h4 class="prep-group">${escapeHtml(l.name)} (${l.positionen.length})</h4>
      <div class="table-scroll">
        <table>
          <thead><tr><th>${t("ui.produkt")}</th><th>${t("ui.bestand")}</th><th>${t("ui.soll")}</th><th>${t("ui.bestellen")}</th></tr></thead>
          <tbody>
            ${l.positionen
              .map(
                (pos) => `
              <tr data-name="${escapeHtml(pos.name)}">
                <td>${escapeHtml(pos.name)}</td>
                <td>${formatNumberLocal(pos.bestand)}</td>
                <td>${formatNumberLocal(pos.soll)}</td>
                <td><input type="number" class="order-qty" min="0" step="0.5" value="${pos.menge}" aria-label="Bestellmenge ${escapeHtml(pos.name)}" /> ${escapeHtml(pos.einheit)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    )
    .join("");

  const fehlend =
    v.ohneParLevel.length > 0
      ? `<h4 class="prep-group">${t("ui.soll_bestand_fehlt")}${v.ohneParLevel.length})</h4>
         <p class="empty-note">${t("ui.fuer_diese_gezaehlten_produkte_ist_kein_14f6")} ${escapeHtml(v.ohneParLevel.join(", "))}</p>`
      : "";

  return bloecke + fehlend;
}
