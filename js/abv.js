// Alkohol-Mathematik an einer Stelle.
//
// Reine Rechenfunktionen ohne Zugriff auf die Oberfläche: keine DOM-Zugriffe,
// keine Seiteneffekte. Genutzt vom Verdünnungs-Rechner und vom
// Flaschen-Modus im Batching, damit beide identisch rechnen.

// Liest den Alkoholgehalt aus dem Textfeld eines Produkts.
// In der Datenbank steht dort Freitext wie "40 % vol", "43,1 % vol" oder
// "42 % vol (bitte gegen Flasche prüfen)". Gibt null zurück, wenn sich keine
// Zahl finden lässt – Aufrufer müssen den Fall "unbekannt" sichtbar machen
// statt stillschweigend mit 0 zu rechnen.
export function parseAbv(text) {
  if (typeof text === "number") return Number.isFinite(text) ? text : null;
  const treffer = String(text ?? "").match(/-?\d+(?:[.,]\d+)?/);
  if (!treffer) return null;
  const zahl = parseFloat(treffer[0].replace(",", "."));
  return Number.isFinite(zahl) ? zahl : null;
}

// Reiner Alkohol in ml. items: [{ amountMl, abv }], abv in Prozent.
export function alcoholMl(items) {
  return items.reduce((summe, i) => {
    const menge = Number(i.amountMl) || 0;
    const gehalt = Number(i.abv) || 0;
    return summe + (menge * gehalt) / 100;
  }, 0);
}

// Alkoholgehalt in Prozent, nachdem waterMl Wasser (oder Schmelzwasser)
// dazugekommen ist.
export function abvAfterWater(alcoholMl, volumeMl, waterMl) {
  const gesamt = (Number(volumeMl) || 0) + (Number(waterMl) || 0);
  if (gesamt <= 0) return 0;
  return (alcoholMl / gesamt) * 100;
}

// Wieviel Wasser nötig ist, um auf einen Ziel-Alkoholgehalt zu kommen.
// Liegt das Ziel über dem aktuellen Gehalt, ist die Antwort 0 – Wasser kann
// nur verdünnen, nie verstärken.
export function waterForTargetAbv(alcoholMl, volumeMl, targetAbv) {
  const ziel = Number(targetAbv) || 0;
  if (ziel <= 0) return 0;
  const noetig = (alcoholMl / ziel) * 100 - (Number(volumeMl) || 0);
  return noetig > 0 ? noetig : 0;
}
