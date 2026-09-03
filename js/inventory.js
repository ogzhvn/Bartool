import {
  loadInventoryCounts,
  saveInventoryCount,
  deleteInventoryCount,
  onInventoryCountsChanged,
  loadInventoryItems,
  saveInventoryItems,
  isOffline,
} from "./storage.js";
import { getAllProducts } from "./productLibrary.js";
import { onProductsChanged } from "./storage.js";
import { isAdmin, getCurrentUser } from "./auth.js";
import { escapeHtml } from "./utils.js";

// Inventur, Teil 1: Erfassung.
//
// Im Lager oder Kühlhaus ist selten Empfang. Jede Eingabe landet deshalb
// sofort in einem lokalen Zwischenspeicher; hochgeladen wird gebündelt beim
// Speichern oder automatisch, sobald wieder Netz da ist. Ein
// Verbindungsabbruch darf niemals eine Zählung kosten.

const listEl = document.getElementById("inv-count-list");
const newBtn = document.getElementById("inv-new-count");
const countViewEl = document.getElementById("inv-count-view");
const overviewEl = document.getElementById("inv-overview");
const titleEl = document.getElementById("inv-current-title");
const progressEl = document.getElementById("inv-progress");
const searchEl = document.getElementById("inv-search");
const itemsEl = document.getElementById("inv-items");
const saveBtn = document.getElementById("inv-save");
const closeBtn = document.getElementById("inv-close-count");
const backBtn = document.getElementById("inv-back");
const statusEl = document.getElementById("inv-status");

// Die gerade geöffnete Zählung und ihr Stand.
let aktuelleZaehlung = null;
// { produktname: { quantity, unit } } – quantity null heißt "nicht gezählt".
let stand = {};
// Namen mit noch nicht hochgeladenen Änderungen.
let offen = new Set();

function draftKey(id) {
  return `bartool:inventory-draft:${id}`;
}

function readDraft(id) {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeDraft(id) {
  try {
    localStorage.setItem(draftKey(id), JSON.stringify({ stand, offen: [...offen] }));
  } catch {
    // Zwischenspeicher voll: der Upload bleibt der eigentliche Weg.
  }
}

function clearDraft(id) {
  try {
    localStorage.removeItem(draftKey(id));
  } catch {
    /* egal */
  }
}

function formatDate(value) {
  if (!value) return "–";
  return new Date(value).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function setStatus(text, warnung = false) {
  statusEl.hidden = !text;
  statusEl.textContent = text;
  statusEl.classList.toggle("inv-status-warn", warnung);
}

// ---------------------------------------------------------------------
// Übersicht der Zählungen
// ---------------------------------------------------------------------

function renderCountList() {
  const zaehlungen = loadInventoryCounts();
  if (zaehlungen.length === 0) {
    listEl.innerHTML = `<p class="empty-note">Noch keine Zählung angelegt.</p>`;
    return;
  }
  listEl.innerHTML = zaehlungen
    .map(
      (z) => `
      <div class="inv-count-item" data-id="${escapeHtml(z.id)}">
        <div class="prep-item-head">
          <strong>${escapeHtml(z.title || "Inventur")}</strong>
          <span class="prep-status">${z.status === "abgeschlossen" ? "abgeschlossen" : "offen"}</span>
        </div>
        <p class="prep-meta">Zähldatum ${formatDate(z.countedOn)}${z.note ? " · " + escapeHtml(z.note) : ""}</p>
        <div class="actions">
          <button type="button" class="btn-secondary inv-open">${z.status === "abgeschlossen" ? "Ansehen" : "Weiterzählen"}</button>
          ${isAdmin() ? `<button type="button" class="btn-secondary inv-delete">Löschen</button>` : ""}
        </div>
      </div>`
    )
    .join("");
}

// ---------------------------------------------------------------------
// Zähl-Ansicht
// ---------------------------------------------------------------------

function gezaehlt() {
  return Object.values(stand).filter((e) => e && e.quantity !== null && e.quantity !== "").length;
}

function renderProgress() {
  const gesamt = getAllProducts().length;
  progressEl.textContent = `${gezaehlt()} von ${gesamt} Produkten gezählt${
    offen.size > 0 ? ` · ${offen.size} noch nicht hochgeladen` : ""
  }`;
}

function gefilterteProdukte() {
  const suche = searchEl.value.trim().toLowerCase();
  const alle = getAllProducts();
  if (!suche) return alle;
  return alle.filter(
    (p) =>
      p.name.toLowerCase().includes(suche) ||
      String(p.category ?? "").toLowerCase().includes(suche) ||
      String(p.group ?? "").toLowerCase().includes(suche)
  );
}

function renderItems() {
  const produkte = gefilterteProdukte();
  const gesperrt = aktuelleZaehlung?.status === "abgeschlossen";

  // Nach Kategorie gruppieren, damit man sich beim Zählen am Regal
  // entlangarbeiten kann statt alphabetisch zu springen.
  const gruppen = new Map();
  produkte.forEach((p) => {
    const key = p.group || p.category || "Ohne Kategorie";
    if (!gruppen.has(key)) gruppen.set(key, []);
    gruppen.get(key).push(p);
  });

  // Alphabetisch, damit die Reihenfolge beim nächsten Zählen dieselbe ist
  // und man eine Kategorie wiederfindet. Die Datenreihenfolge wäre zufällig.
  const sortierteGruppen = [...gruppen.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], "de")
  );

  const bloecke = sortierteGruppen.map(([gruppe, liste]) => {
    const zeilen = liste
      .map((p) => {
        const wert = stand[p.name]?.quantity;
        const anzeige = wert === null || wert === undefined ? "" : wert;
        return `
        <div class="inv-row${anzeige === "" ? "" : " inv-row-done"}" data-name="${escapeHtml(p.name)}">
          <span class="inv-row-name">${escapeHtml(p.name)}</span>
          <div class="inv-row-input">
            <button type="button" class="stepper-btn inv-minus" aria-label="Eins weniger"${gesperrt ? " disabled" : ""}>−</button>
            <input type="number" class="inv-qty" inputmode="decimal" step="0.1" min="0" value="${escapeHtml(anzeige)}" placeholder="–" aria-label="Bestand ${escapeHtml(p.name)}"${gesperrt ? " disabled" : ""} />
            <button type="button" class="stepper-btn inv-plus" aria-label="Eins mehr"${gesperrt ? " disabled" : ""}>+</button>
          </div>
        </div>`;
      })
      .join("");
    return `<h4 class="prep-group">${escapeHtml(gruppe)} (${liste.length})</h4>${zeilen}`;
  });

  itemsEl.innerHTML = bloecke.join("") || `<p class="empty-note">Keine Produkte gefunden.</p>`;
}

function setQuantity(name, wert) {
  if (aktuelleZaehlung?.status === "abgeschlossen") return;
  const zahl = wert === "" ? null : Number(wert);
  stand[name] = { quantity: Number.isNaN(zahl) ? null : zahl, unit: stand[name]?.unit ?? "" };
  offen.add(name);
  writeDraft(aktuelleZaehlung.id);
  renderProgress();
}

async function upload({ still = false } = {}) {
  if (!aktuelleZaehlung || offen.size === 0) {
    if (!still) setStatus("Nichts zu speichern – alles ist schon hochgeladen.");
    return;
  }
  if (isOffline()) {
    if (!still) {
      setStatus(
        `Offline: ${offen.size} Eingabe(n) sind lokal gesichert und werden automatisch hochgeladen, sobald wieder Netz da ist.`,
        true
      );
    }
    return;
  }
  const eintraege = [...offen].map((name) => ({
    productName: name,
    quantity: stand[name]?.quantity ?? null,
    unit: stand[name]?.unit ?? "",
  }));
  try {
    await saveInventoryItems(aktuelleZaehlung.id, eintraege);
    offen.clear();
    writeDraft(aktuelleZaehlung.id);
    renderProgress();
    setStatus(`${eintraege.length} Eingabe(n) gespeichert.`);
  } catch (error) {
    setStatus("Speichern fehlgeschlagen: " + error.message + " Die Eingaben bleiben lokal gesichert.", true);
  }
}

async function openCount(zaehlung) {
  aktuelleZaehlung = zaehlung;
  titleEl.textContent = `${zaehlung.title || "Inventur"} · ${formatDate(zaehlung.countedOn)}`;
  setStatus("");

  // Erst den lokalen Zwischenstand, dann den Server – so ist sofort etwas da
  // und eine unterbrochene Zählung geht nie verloren.
  const draft = readDraft(zaehlung.id);
  stand = draft?.stand ?? {};
  offen = new Set(draft?.offen ?? []);

  try {
    const vomServer = await loadInventoryItems(zaehlung.id);
    // Lokale, noch nicht hochgeladene Eingaben haben Vorrang.
    Object.entries(vomServer).forEach(([name, wert]) => {
      if (!offen.has(name)) stand[name] = wert;
    });
  } catch {
    setStatus("Server nicht erreichbar – es wird mit dem lokalen Stand weitergezählt.", true);
  }

  const gesperrt = zaehlung.status === "abgeschlossen";
  saveBtn.hidden = gesperrt;
  closeBtn.hidden = gesperrt;

  overviewEl.hidden = true;
  countViewEl.hidden = false;
  renderProgress();
  renderItems();
  if (offen.size > 0) upload({ still: true });
}

function backToOverview() {
  aktuelleZaehlung = null;
  countViewEl.hidden = true;
  overviewEl.hidden = false;
  renderCountList();
}

async function handleNewCount() {
  const heute = new Date();
  const titel = prompt(
    "Bezeichnung der Zählung:",
    `Inventur ${heute.toLocaleDateString("de-DE", { month: "long", year: "numeric" })}`
  );
  if (titel === null) return;
  try {
    const neu = await saveInventoryCount({
      countedOn: new Date(heute.getTime() - heute.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 10),
      title: titel.trim() || "Inventur",
      status: "offen",
      createdBy: getCurrentUser()?.id ?? null,
    });
    await openCount(neu);
  } catch (error) {
    alert("Zählung konnte nicht angelegt werden: " + error.message);
  }
}

async function handleCloseCount() {
  if (!aktuelleZaehlung) return;
  const fehlend = getAllProducts().length - gezaehlt();
  const frage =
    fehlend > 0
      ? `${fehlend} Produkt(e) wurden nicht gezählt. Zählung trotzdem abschließen? Danach ist sie schreibgeschützt.`
      : "Zählung abschließen? Danach ist sie schreibgeschützt.";
  if (!confirm(frage)) return;
  await upload({ still: true });
  try {
    const aktualisiert = await saveInventoryCount({ ...aktuelleZaehlung, status: "abgeschlossen" });
    aktuelleZaehlung = aktualisiert;
    clearDraft(aktualisiert.id);
    backToOverview();
  } catch (error) {
    alert("Zählung konnte nicht abgeschlossen werden: " + error.message);
  }
}

export function initInventory() {
  renderCountList();
  onInventoryCountsChanged(() => {
    if (!aktuelleZaehlung) renderCountList();
  });
  onProductsChanged(() => {
    if (aktuelleZaehlung) {
      renderProgress();
      renderItems();
    }
  });

  newBtn.addEventListener("click", handleNewCount);
  backBtn.addEventListener("click", backToOverview);
  saveBtn.addEventListener("click", () => upload());
  closeBtn.addEventListener("click", handleCloseCount);
  searchEl.addEventListener("input", renderItems);

  listEl.addEventListener("click", async (e) => {
    const box = e.target.closest(".inv-count-item");
    if (!box) return;
    const zaehlung = loadInventoryCounts().find((z) => z.id === box.dataset.id);
    if (!zaehlung) return;
    if (e.target.closest(".inv-open")) await openCount(zaehlung);
    else if (e.target.closest(".inv-delete")) {
      if (!confirm(`Zählung "${zaehlung.title || "Inventur"}" mit allen Positionen löschen?`)) return;
      try {
        await deleteInventoryCount(zaehlung.id);
        clearDraft(zaehlung.id);
      } catch (error) {
        alert("Zählung konnte nicht gelöscht werden: " + error.message);
      }
    }
  });

  // Eingaben in der Zählliste
  itemsEl.addEventListener("input", (e) => {
    const feld = e.target.closest(".inv-qty");
    if (!feld) return;
    const zeile = feld.closest(".inv-row");
    setQuantity(zeile.dataset.name, feld.value);
    zeile.classList.toggle("inv-row-done", feld.value !== "");
  });

  itemsEl.addEventListener("click", (e) => {
    const knopf = e.target.closest(".inv-minus, .inv-plus");
    if (!knopf) return;
    const zeile = knopf.closest(".inv-row");
    const feld = zeile.querySelector(".inv-qty");
    const schritt = knopf.classList.contains("inv-plus") ? 1 : -1;
    const neu = Math.max(0, (parseFloat(feld.value) || 0) + schritt);
    feld.value = neu;
    setQuantity(zeile.dataset.name, feld.value);
    zeile.classList.add("inv-row-done");
  });

  // Sobald wieder Netz da ist, den Rückstand von selbst hochladen.
  window.addEventListener("online", () => {
    if (aktuelleZaehlung && offen.size > 0) upload();
  });
}
