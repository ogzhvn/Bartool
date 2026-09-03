// Reine ABV-Mathematik, keine DOM-Zugriffe, keine Seiteneffekte.

export function parseAbv(text) {
  const match = String(text ?? "")
    .replace(",", ".")
    .match(/\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

export function alcoholMl(items) {
  return items.reduce((sum, item) => sum + (item.amountMl * item.abv) / 100, 0);
}

export function abvAfterWater(alcoholMl, volumeMl, waterMl) {
  const denominator = volumeMl + waterMl;
  if (denominator === 0) return 0;
  return (alcoholMl / denominator) * 100;
}

export function waterForTargetAbv(alcoholMl, volumeMl, targetAbv) {
  const water = (alcoholMl / targetAbv) * 100 - volumeMl;
  return water < 0 ? 0 : water;
}
