import {
  loadPreparations,
  savePreparation,
  deletePreparation,
  onPreparationsChanged,
} from "./storage.js";
import { isAdmin, getCurrentUser } from "./auth.js";
import { escapeHtml, formatNumber } from "./utils.js";

// Mise en Place: welche Ansätze stehen, wie lange halten sie noch.
//
// Abgelaufene bleiben bewusst sichtbar, bis jemand sie abhakt – so
// verschwindet nichts unbemerkt und man sieht, was noch entsorgt gehört.

// Standard-Haltbarkeit in Tagen je Art, vom Nutzer festgelegt. Beim Anlegen
// ist das Datum immer noch von Hand änderbar; das hier sind nur Startwerte.
export const HALTBARKEIT_TAGE = {
  superjuice: 7,
  sirup: 28,
  batch: 90,
  batch_juice: 3,
  sonstiges: 7,
};

export const TYP_LABELS = {
  superjuice: "Superjuice",
  sirup: "Zuckersirup",
  batch: "Batch (alkoholisch)",
  batch_juice: "Batch mit Frischsaft",
  sonstiges: "Sonstiges",
};

const WARNUNG_TAGE = 2;

const listEl = document.getElementById("prep-list");
const formEl = document.getElementById("prep-form");
const labelEl = document.getElementById("prep-label");
const typeEl = document.getElementById("prep-type");
const sizeEl = document.getElementById("prep-size");
const abvEl = document.getElementById("prep-abv");
const locationEl = document.getElementById("prep-location");
const madeAtEl = document.getElementById("prep-made-at");
const expiresEl = document.getElementById("prep-expires");
const notesEl = document.getElementById("prep-notes");
const showDoneEl = document.getElementById("prep-show-done");

// Datum für ein <input type="date"> (lokale Zeit, nicht UTC – sonst
// verschiebt sich das Datum abends um einen Tag).
function toDateInput(value) {
  const d = value ? new Date(value) : new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "–";
  return new Date(value).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Volle Tage bis zum Ablauf, gerechnet ab heute 0 Uhr, damit "läuft morgen ab"
// nicht von der Uhrzeit des Ansetzens abhängt.
function tageBis(expiresAt) {
  if (!expiresAt) return null;
  const heute = new Date();
  heute.setHours(0, 0, 0, 0);
  const ziel = new Date(expiresAt);
  ziel.setHours(0, 0, 0, 0);
  return Math.round((ziel - heute) / 86400000);
}

export function haltbarBis(prepType, madeAtDate) {
  const tage = HALTBARKEIT_TAGE[prepType] ?? HALTBARKEIT_TAGE.sonstiges;
  const d = new Date(madeAtDate ?? Date.now());
  d.setDate(d.getDate() + tage);
  return d;
}

function updateExpiryFromType() {
  const basis = madeAtEl.value ? new Date(madeAtEl.value) : new Date();
  expiresEl.value = toDateInput(haltbarBis(typeEl.value, basis));
}

function resetForm() {
  formEl.reset();
  typeEl.value = "sonstiges";
  madeAtEl.value = toDateInput();
  updateExpiryFromType();
  formEl.dataset.editId = "";
  document.getElementById("prep-submit").textContent = "Ansatz speichern";
  document.getElementById("prep-cancel").hidden = true;
}

function eintragHtml(prep) {
  const tage = tageBis(prep.expiresAt);
  const verbraucht = prep.status === "verbraucht";
  let status = "";
  if (verbraucht) status = "verbraucht";
  else if (tage === null) status = "ohne Datum";
  else if (tage < 0) status = `seit ${Math.abs(tage)} Tag(en) abgelaufen`;
  else if (tage === 0) status = "läuft heute ab";
  else status = `noch ${tage} Tag(e)`;

  const details = [
    prep.batchSizeMl ? `${formatNumber(Number(prep.batchSizeMl))} ml` : "",
    prep.abv !== "" && prep.abv != null ? `${formatNumber(Number(prep.abv))} % ABV` : "",
    prep.location,
    `angesetzt ${formatDate(prep.madeAt)}`,
    `haltbar bis ${formatDate(prep.expiresAt)}`,
  ].filter(Boolean);

  const abgelaufen = !verbraucht && tage !== null && tage < 0;
  const bald = !verbraucht && tage !== null && tage >= 0 && tage <= WARNUNG_TAGE;

  return `
    <div class="prep-item${verbraucht ? " prep-done" : abgelaufen ? " prep-expired" : bald ? " prep-soon" : ""}" data-id="${escapeHtml(prep.id)}">
      <div class="prep-item-head">
        <strong>${escapeHtml(prep.label)}</strong>
        <span class="prep-status">${escapeHtml(status)}</span>
      </div>
      <p class="prep-meta">${escapeHtml(TYP_LABELS[prep.prepType] ?? prep.prepType)} · ${escapeHtml(details.join(" · "))}</p>
      ${prep.notes ? `<p class="prep-meta">${escapeHtml(prep.notes)}</p>` : ""}
      <div class="actions">
        ${verbraucht
          ? `<button type="button" class="btn-secondary prep-reactivate">Wieder aktiv</button>`
          : `<button type="button" class="btn-secondary prep-done-btn">Verbraucht</button>
             <button type="button" class="btn-secondary prep-edit">Bearbeiten</button>`}
        ${isAdmin() ? `<button type="button" class="btn-secondary prep-delete">Löschen</button>` : ""}
      </div>
    </div>`;
}

function gruppeHtml(titel, eintraege, leerText) {
  if (eintraege.length === 0 && !leerText) return "";
  return `
    <h4 class="prep-group">${escapeHtml(titel)} (${eintraege.length})</h4>
    ${eintraege.length === 0 ? `<p class="empty-note">${escapeHtml(leerText)}</p>` : eintraege.map(eintragHtml).join("")}
  `;
}

function render() {
  const alle = loadPreparations();
  const aktiv = alle.filter((p) => p.status !== "verbraucht");
  const verbraucht = alle.filter((p) => p.status === "verbraucht");

  const abgelaufen = aktiv.filter((p) => {
    const t = tageBis(p.expiresAt);
    return t !== null && t < 0;
  });
  const bald = aktiv.filter((p) => {
    const t = tageBis(p.expiresAt);
    return t !== null && t >= 0 && t <= WARNUNG_TAGE;
  });
  const laufend = aktiv.filter((p) => !abgelaufen.includes(p) && !bald.includes(p));

  const sortiert = (liste) =>
    [...liste].sort((a, b) => new Date(a.expiresAt ?? 0) - new Date(b.expiresAt ?? 0));

  listEl.innerHTML =
    gruppeHtml("Abgelaufen", sortiert(abgelaufen)) +
    gruppeHtml(`Läuft bald ab (≤ ${WARNUNG_TAGE} Tage)`, sortiert(bald)) +
    gruppeHtml("Aktiv", sortiert(laufend), alle.length === 0 ? "Noch keine Ansätze erfasst." : "") +
    (showDoneEl.checked ? gruppeHtml("Verbraucht", sortiert(verbraucht)) : "");
}

async function handleSubmit(e) {
  e.preventDefault();
  const label = labelEl.value.trim();
  if (!label) {
    alert("Bitte einen Namen für den Ansatz eintragen.");
    return;
  }
  const prep = {
    id: formEl.dataset.editId || undefined,
    label,
    prepType: typeEl.value,
    batchSizeMl: sizeEl.value,
    abv: abvEl.value,
    location: locationEl.value.trim(),
    madeAt: madeAtEl.value ? new Date(madeAtEl.value).toISOString() : new Date().toISOString(),
    expiresAt: expiresEl.value ? new Date(expiresEl.value).toISOString() : null,
    notes: notesEl.value.trim(),
    status: "aktiv",
    madeBy: getCurrentUser()?.id ?? null,
  };
  try {
    await savePreparation(prep);
    resetForm();
  } catch (error) {
    alert("Ansatz konnte nicht gespeichert werden: " + error.message);
  }
}

function loadIntoForm(prep) {
  labelEl.value = prep.label;
  typeEl.value = prep.prepType;
  sizeEl.value = prep.batchSizeMl;
  abvEl.value = prep.abv;
  locationEl.value = prep.location;
  madeAtEl.value = toDateInput(prep.madeAt);
  expiresEl.value = prep.expiresAt ? toDateInput(prep.expiresAt) : "";
  notesEl.value = prep.notes;
  formEl.dataset.editId = prep.id;
  document.getElementById("prep-submit").textContent = "Änderung speichern";
  document.getElementById("prep-cancel").hidden = false;
  formEl.scrollIntoView({ block: "start" });
}

async function setStatus(prep, status) {
  try {
    await savePreparation({ ...prep, status });
  } catch (error) {
    alert("Status konnte nicht geändert werden: " + error.message);
  }
}

// Wird vom Batching aufgerufen: Ergebnis direkt als Ansatz übernehmen.
export function prefillPreparation({ label, prepType, batchSizeMl, abv, recipeName }) {
  resetForm();
  labelEl.value = label ?? "";
  if (prepType && TYP_LABELS[prepType]) typeEl.value = prepType;
  sizeEl.value = batchSizeMl ?? "";
  abvEl.value = abv ?? "";
  formEl.dataset.recipeName = recipeName ?? "";
  updateExpiryFromType();
  labelEl.focus();
}

export function initPreparations() {
  resetForm();
  render();
  onPreparationsChanged(render);

  formEl.addEventListener("submit", handleSubmit);
  typeEl.addEventListener("change", updateExpiryFromType);
  madeAtEl.addEventListener("change", updateExpiryFromType);
  showDoneEl.addEventListener("change", render);
  document.getElementById("prep-cancel").addEventListener("click", resetForm);

  listEl.addEventListener("click", async (e) => {
    const box = e.target.closest(".prep-item");
    if (!box) return;
    const prep = loadPreparations().find((p) => p.id === box.dataset.id);
    if (!prep) return;

    if (e.target.closest(".prep-done-btn")) await setStatus(prep, "verbraucht");
    else if (e.target.closest(".prep-reactivate")) await setStatus(prep, "aktiv");
    else if (e.target.closest(".prep-edit")) loadIntoForm(prep);
    else if (e.target.closest(".prep-delete")) {
      if (!confirm(`Ansatz "${prep.label}" wirklich löschen?`)) return;
      try {
        await deletePreparation(prep.id);
      } catch (error) {
        alert("Ansatz konnte nicht gelöscht werden: " + error.message);
      }
    }
  });
}
