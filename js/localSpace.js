// Platz im localStorage (Paket nach dem Login-Ausfall vom 12.10.2026).
//
// Die Offline-Puffer aus js/storage.js belegen zusammen gut zwei Millionen
// Zeichen, allein der Fragenkatalog rund 1,4 Millionen. Safari erlaubt pro
// Seite nur etwa 5 MB. War der Speicher voll, scheiterte nach dem Login das
// Ablegen der Sitzung – der Server hatte angemeldet, die App blieb trotzdem
// auf dem Anmeldeformular stehen, ohne Fehlermeldung.
//
// Der Fragenkatalog liegt seitdem in IndexedDB (js/idbCache.js). Bleibt als
// Sicherung: Wird es eng, weichen Puffer – sie sind jederzeit neu ladbar.
// Unangetastet bleibt, was nur hier liegt: Inventur-Entwürfe (ungespeicherte
// Zählungen) und der Eigentümer-Vermerk der Betriebspuffer.

const PUFFER_PREFIX = "bartool:";
const NIE_RAEUMEN_PREFIXE = ["bartool:inventory-draft:", "bartool:cache-owner"];

function istPlatzFehler(error) {
  return (
    error?.name === "QuotaExceededError" ||
    error?.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error?.code === 22 ||
    error?.code === 1014
  );
}

// Alle räumbaren Puffer außer `ausser`, größter zuerst – so ist mit
// möglichst wenig Löschen möglichst viel Platz frei.
export function alleRaeumbarenPuffer(ausser) {
  const liste = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || key === ausser || !key.startsWith(PUFFER_PREFIX)) continue;
      if (NIE_RAEUMEN_PREFIXE.some((prefix) => key.startsWith(prefix))) continue;
      liste.push([key, localStorage.getItem(key)?.length ?? 0]);
    }
  } catch {
    return [];
  }
  return liste.sort((a, b) => b[1] - a[1]).map(([key]) => key);
}

// Schreibt `wert`; ist kein Platz, wird der Reihe nach je ein Schlüssel aus
// `opfer` entfernt und erneut versucht. Wirft den letzten Fehler, wenn es
// trotzdem nicht passt – der Aufrufer entscheidet, ob das schlimm ist.
export function schreibeMitPlatz(key, wert, opfer = []) {
  try {
    localStorage.setItem(key, wert);
    return;
  } catch (error) {
    if (!istPlatzFehler(error)) throw error;
    let letzter = error;
    for (const kandidat of opfer) {
      if (kandidat === key) continue;
      try {
        localStorage.removeItem(kandidat);
        localStorage.setItem(key, wert);
        return;
      } catch (nochmal) {
        if (!istPlatzFehler(nochmal)) throw nochmal;
        letzter = nochmal;
      }
    }
    throw letzter;
  }
}
