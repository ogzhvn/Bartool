import { getAllProducts } from "./productLibrary.js";
import { ingredientCost } from "./costing.js";
import { escapeHtml, formatNumberDe } from "./utils.js";

// Auswertung einer Zählung und Bestellvorschlag.
//
// Zwei Fragen: Was ist der Bestand wert, und was muss nachbestellt werden.
// Beides nur so gut wie die gepflegten Daten – fehlende Preise und
// Soll-Bestände werden deshalb ausgewiesen statt als 0 durchgerechnet.

export function formatEuro(n) {
  return `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
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
      gruppe: p.group || p.category || "Ohne Kategorie",
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
    zeilen: zeilen.sort((a, b) => a.name.localeCompare(b.name, "de")),
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
    const lieferant = p.supplier || "Ohne Lieferant";
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
      .sort((a, b) => a[0].localeCompare(b[0], "de"))
      .map(([name, positionen]) => ({
        name,
        positionen: positionen.sort((a, b) => a.name.localeCompare(b.name, "de")),
      })),
    ohneParLevel: ohneParLevel.sort((a, b) => a.localeCompare(b, "de")),
  };
}

export function renderAuswertungHtml(a, diff) {
  const gruppenZeilen = a.gruppen
    .map(
      ([gruppe, d]) =>
        `<tr><td>${escapeHtml(gruppe)}</td><td>${d.positionen}</td><td>${formatEuro(d.wert)}</td></tr>`
    )
    .join("");

  const diffBlock =
    diff && diff.length > 0
      ? `
      <h4 class="prep-group">Veränderung zur letzten Zählung (${diff.length})</h4>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Produkt</th><th>vorher</th><th>jetzt</th><th>Differenz</th></tr></thead>
          <tbody>
            ${diff
              .map(
                (d) =>
                  `<tr><td>${escapeHtml(d.name)}</td><td>${formatNumberDe(d.alt)}</td><td>${formatNumberDe(d.jetzt)}</td><td class="${d.delta < 0 ? "menu-quote-high" : "menu-quote-ok"}">${d.delta > 0 ? "+" : ""}${formatNumberDe(d.delta)}</td></tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
      : diff
        ? `<p class="empty-note">Keine Veränderung gegenüber der letzten abgeschlossenen Zählung.</p>`
        : `<p class="empty-note">Keine frühere abgeschlossene Zählung zum Vergleich vorhanden.</p>`;

  return `
    <div class="home-stats">
      <div class="stat-tile"><span class="stat-value">${formatEuro(a.gesamtwert)}</span><span class="stat-label">Bestandswert</span></div>
      <div class="stat-tile"><span class="stat-value">${a.gezaehlt}</span><span class="stat-label">gezählte Positionen</span></div>
      <div class="stat-tile"><span class="stat-value">${a.gesamtProdukte - a.gezaehlt}</span><span class="stat-label">nicht gezählt</span></div>
    </div>
    ${
      a.ohnePreis > 0
        ? `<p class="empty-note">${a.ohnePreis} gezählte Position(en) ohne Einkaufspreis – die fehlen im Bestandswert. Preis im Produkt eintragen.</p>`
        : ""
    }
    <h4 class="prep-group">Wert nach Kategorie</h4>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Kategorie</th><th>Positionen</th><th>Wert</th></tr></thead>
        <tbody>${gruppenZeilen}</tbody>
      </table>
    </div>
    ${diffBlock}`;
}

export function renderBestellvorschlagHtml(v) {
  if (v.lieferanten.length === 0 && v.ohneParLevel.length === 0) {
    return `<p class="empty-note">Nichts nachzubestellen – oder es sind noch keine Soll-Bestände gepflegt.</p>`;
  }

  const bloecke = v.lieferanten
    .map(
      (l) => `
      <h4 class="prep-group">${escapeHtml(l.name)} (${l.positionen.length})</h4>
      <div class="table-scroll">
        <table>
          <thead><tr><th>Produkt</th><th>Bestand</th><th>Soll</th><th>Bestellen</th></tr></thead>
          <tbody>
            ${l.positionen
              .map(
                (pos) => `
              <tr data-name="${escapeHtml(pos.name)}">
                <td>${escapeHtml(pos.name)}</td>
                <td>${formatNumberDe(pos.bestand)}</td>
                <td>${formatNumberDe(pos.soll)}</td>
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
      ? `<h4 class="prep-group">Soll-Bestand fehlt (${v.ohneParLevel.length})</h4>
         <p class="empty-note">Für diese gezählten Produkte ist kein Soll-Bestand gepflegt, deshalb gibt es keinen Vorschlag: ${escapeHtml(v.ohneParLevel.join(", "))}</p>`
      : "";

  return bloecke + fehlend;
}
