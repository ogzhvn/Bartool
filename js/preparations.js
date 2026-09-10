import {
  loadPreparations,
  savePreparation,
  deletePreparation,
  onPreparationsChanged,
} from "./storage.js";
import { can, getCurrentUser, getCurrentProfile } from "./auth.js";
import { printLabels } from "./printView.js";
import { escapeHtml, formatNumberLocal } from "./utils.js";
import { formatDate, onLanguageChanged, t } from "./i18n.js";

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

const TYP_LABEL_KEYS = {
  superjuice: "ui.superjuice",
  sirup: "ui.zuckersirup",
  batch: "ui.batch_alkoholisch",
  batch_juice: "ui.batch_mit_frischsaft",
  sonstiges: "ui.sonstiges",
};

// Erst beim Rendern übersetzt, damit ein Sprachwechsel ohne Neuladen wirkt.
export function typLabel(typ) {
  return TYP_LABEL_KEYS[typ] ? t(TYP_LABEL_KEYS[typ]) : typ;
}

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
const labelCountEl = document.getElementById("prep-label-count");

// Datum für ein <input type="date"> (lokale Zeit, nicht UTC – sonst
// verschiebt sich das Datum abends um einen Tag).
function toDateInput(value) {
  const d = value ? new Date(value) : new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
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
  document.getElementById("prep-submit").textContent = t("ui.ansatz_speichern");
  document.getElementById("prep-cancel").hidden = true;
}

function eintragHtml(prep) {
  const tage = tageBis(prep.expiresAt);
  const verbraucht = prep.status === "verbraucht";
  let status = "";
  if (verbraucht) status = t("ui.verbraucht_klein");
  else if (tage === null) status = t("ui.ohne_datum");
  else if (tage < 0) status = `${t("ui.seit")} ${Math.abs(tage)} ${t("ui.tag_en_abgelaufen")}`;
  else if (tage === 0) status = t("ui.laeuft_heute_ab");
  else status = t("ui.noch_tage", { tage });

  const details = [
    prep.batchSizeMl ? `${formatNumberLocal(prep.batchSizeMl)} ml` : "",
    prep.abv !== "" && prep.abv != null ? `${formatNumberLocal(prep.abv)} % ABV` : "",
    prep.location,
    `angesetzt ${formatDate(prep.madeAt)}`,
    `${t("ui.haltbar_bis_08c8")} ${formatDate(prep.expiresAt)}`,
  ].filter(Boolean);

  const abgelaufen = !verbraucht && tage !== null && tage < 0;
  const bald = !verbraucht && tage !== null && tage >= 0 && tage <= WARNUNG_TAGE;

  return `
    <div class="prep-item${verbraucht ? " prep-done" : abgelaufen ? " prep-expired" : bald ? " prep-soon" : ""}" data-id="${escapeHtml(prep.id)}">
      <div class="prep-item-head">
        <strong>${escapeHtml(prep.label)}</strong>
        <span class="prep-status">${escapeHtml(status)}</span>
      </div>
      <p class="prep-meta">${escapeHtml(typLabel(prep.prepType))} · ${escapeHtml(details.join(" · "))}</p>
      ${prep.notes ? `<p class="prep-meta">${escapeHtml(prep.notes)}</p>` : ""}
      <div class="actions">
        ${verbraucht
          ? `<button type="button" class="btn-secondary prep-reactivate">${t("ui.wieder_aktiv")}</button>`
          : `<button type="button" class="btn-secondary prep-done-btn">${t("ui.verbraucht")}</button>
             <button type="button" class="btn-secondary prep-edit">${t("ui.bearbeiten")}</button>`}
        <button type="button" class="btn-secondary prep-label-btn">${t("ui.etikett")}</button>
        ${can("preparations.manage") ? `<button type="button" class="btn-secondary prep-delete">${t("ui.loeschen")}</button>` : ""}
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
    const tage = tageBis(p.expiresAt);
    return t !== null && t < 0;
  });
  const bald = aktiv.filter((p) => {
    const tage = tageBis(p.expiresAt);
    return t !== null && t >= 0 && t <= WARNUNG_TAGE;
  });
  const laufend = aktiv.filter((p) => !abgelaufen.includes(p) && !bald.includes(p));

  const sortiert = (liste) =>
    [...liste].sort((a, b) => new Date(a.expiresAt ?? 0) - new Date(b.expiresAt ?? 0));

  listEl.innerHTML =
    gruppeHtml(t("ui.abgelaufen"), sortiert(abgelaufen)) +
    gruppeHtml(`${t("ui.laeuft_bald_ab")} ${WARNUNG_TAGE} ${t("ui.tage")}`, sortiert(bald)) +
    gruppeHtml(t("ui.aktiv"), sortiert(laufend), alle.length === 0 ? t("ui.noch_keine_ansaetze_erfasst") : "") +
    (showDoneEl.checked ? gruppeHtml(t("ui.verbraucht"), sortiert(verbraucht)) : "");
}

async function handleSubmit(e) {
  e.preventDefault();
  const label = labelEl.value.trim();
  if (!label) {
    alert(t("ui.bitte_einen_namen_fuer_den_ansatz_eintragen"));
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
    alert(t("ui.ansatz_konnte_nicht_gespeichert_werden") + error.message);
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
  document.getElementById("prep-submit").textContent = t("ui.aenderung_speichern");
  document.getElementById("prep-cancel").hidden = false;
  formEl.scrollIntoView({ block: "start" });
}

async function setStatus(prep, status) {
  try {
    await savePreparation({ ...prep, status });
  } catch (error) {
    alert(t("ui.status_konnte_nicht_geaendert_werden") + error.message);
  }
}

// Wird vom Batching aufgerufen: Ergebnis direkt als Ansatz übernehmen.
export function prefillPreparation({ label, prepType, batchSizeMl, abv, recipeName }) {
  resetForm();
  labelEl.value = label ?? "";
  if (prepType && TYP_LABEL_KEYS[prepType]) typeEl.value = prepType;
  sizeEl.value = batchSizeMl ?? "";
  abvEl.value = abv ?? "";
  formEl.dataset.recipeName = recipeName ?? "";
  updateExpiryFromType();
  labelEl.focus();
}

export function initPreparations() {
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(render);

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

    if (e.target.closest(".prep-label-btn")) {
      // Den Namen kennen wir nur beim eigenen Konto: die Nutzerliste ist
      // Admin-Sache. Bei Ansätzen von Kolleg:innen bleibt die Zeile weg,
      // statt eine Kennnummer aufs Etikett zu drucken.
      const eigener = prep.madeBy && prep.madeBy === getCurrentUser()?.id;
      const profil = getCurrentProfile();
      const ersteller = eigener ? profil?.display_name || profil?.username || "" : "";
      printLabels(prep, typLabel(prep.prepType), labelCountEl.value, ersteller);
      return;
    }
    if (e.target.closest(".prep-done-btn")) await setStatus(prep, "verbraucht");
    else if (e.target.closest(".prep-reactivate")) await setStatus(prep, "aktiv");
    else if (e.target.closest(".prep-edit")) loadIntoForm(prep);
    else if (e.target.closest(".prep-delete")) {
      if (!confirm(`${t("ui.ansatz")}${prep.label}${t("ui.wirklich_loeschen_b7a7")}`)) return;
      try {
        await deletePreparation(prep.id);
      } catch (error) {
        alert(t("ui.ansatz_konnte_nicht_geloescht_werden") + error.message);
      }
    }
  });
}
