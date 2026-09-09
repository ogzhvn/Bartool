import { getSupabaseClient } from "./supabaseClient.js";
import { escapeHtml } from "./utils.js";
import { saveRecipe, saveProduct, fromRecipeRow, fromProductRow, loadRecipes, loadProducts } from "./storage.js";
import { isAdmin } from "./auth.js";
import { formatDateTime, onLanguageChanged, t } from "./i18n.js";

const filterEl = document.getElementById("audit-log-filter");
const dateFilterEl = document.getElementById("audit-log-date-filter");
const sectionEl = document.getElementById("audit-log-section");
const listEl = document.getElementById("audit-log-list");

let loaded = false;
// Zuletzt geladene Einträge – der Wiederherstellen-Knopf greift darauf zu.
let entriesCache = [];

// Erst beim Rendern übersetzt, damit ein Sprachwechsel ohne Neuladen wirkt.
const TABLE_LABEL_KEYS = { recipes: "ui.rezept", products: "ui.produkt", profiles: "ui.konto" };
const ACTION_LABEL_KEYS = { insert: "ui.angelegt", update: "ui.geaendert", delete: "ui.geloescht" };

// Rein technische Felder, die bei praktisch jeder Änderung mitlaufen und
// im Diff nur Rauschen wären.
const IGNORED_DIFF_KEYS = new Set(["id", "updated_at"]);

function formatValue(value) {
  if (value === null || value === undefined) return "–";
  if (typeof value === "object") return escapeHtml(JSON.stringify(value));
  return escapeHtml(String(value));
}

function computeDiff(entry) {
  const oldData = entry.old_data ?? {};
  const newData = entry.new_data ?? {};
  const keys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
  const rows = [];
  keys.forEach((key) => {
    if (IGNORED_DIFF_KEYS.has(key)) return;
    const oldVal = oldData[key];
    const newVal = newData[key];
    if (JSON.stringify(oldVal) === JSON.stringify(newVal)) return;
    rows.push({ key, oldVal, newVal });
  });
  return rows;
}

// Wiederherstellbar ist alles, wovon ein früherer Stand vorliegt – also
// Änderungen und Löschungen an Rezepten und Produkten. Bei einem Neuanlegen
// gibt es keinen Vorzustand; Konten bleiben außen vor, die gehören ins
// Admin-Panel.
const RESTORABLE_TABLES = { recipes: saveRecipe, products: saveProduct };

// Prüft nur die Daten, nicht die Rechte – der Admin-Check sitzt bewusst
// getrennt davon beim Rendern und beim Ausführen.
export function istWiederherstellbar(entry) {
  if (!RESTORABLE_TABLES[entry.table_name]) return false;
  if (!entry.old_data || !entry.old_data.name) return false;
  return entry.action === "update" || entry.action === "delete";
}

function entryLabel(entry) {
  const data = entry.new_data ?? entry.old_data ?? {};
  return data.name ?? data.email ?? "";
}

async function loadAuditLog() {
  const supabase = getSupabaseClient();
  let query = supabase
    .from("audit_log")
    .select("*, changed_by_profile:profiles!audit_log_changed_by_fkey(username, display_name)")
    .order("changed_at", { ascending: false })
    .limit(200);
  if (filterEl.value) {
    query = query.eq("table_name", filterEl.value);
  }
  if (dateFilterEl.value) {
    const since = new Date();
    since.setDate(since.getDate() - Number(dateFilterEl.value));
    query = query.gte("changed_at", since.toISOString());
  }
  const { data, error } = await query;
  if (error) {
    listEl.innerHTML = `<p class="empty-note">${t("ui.aenderungsverlauf_konnte_nicht_geladen_6ed1")} ${escapeHtml(error.message)}</p>`;
    return;
  }
  entriesCache = data ?? [];
  renderAuditLog(entriesCache);
}

function renderAuditLog(entries) {
  if (entries.length === 0) {
    listEl.innerHTML = `<p class="empty-note">${t("ui.keine_aenderungen_gefunden")}</p>`;
    return;
  }

  listEl.innerHTML = entries
    .map((entry) => {
      const who = entry.changed_by_profile?.display_name || entry.changed_by_profile?.username || t("ui.system");
      const when = formatDateTime(entry.changed_at);
      const tableLabel = TABLE_LABEL_KEYS[entry.table_name] ? t(TABLE_LABEL_KEYS[entry.table_name]) : entry.table_name;
      const actionLabel = ACTION_LABEL_KEYS[entry.action] ? t(ACTION_LABEL_KEYS[entry.action]) : entry.action;
      const label = entryLabel(entry);
      const rows = computeDiff(entry);

      return `
        <details class="audit-entry">
          <summary>${escapeHtml(when)} · ${escapeHtml(tableLabel)} ${escapeHtml(actionLabel)}${
        label ? " · " + escapeHtml(label) : ""
      } · ${escapeHtml(who)}</summary>
          ${
            isAdmin() && istWiederherstellbar(entry)
              ? `<div class="actions"><button type="button" class="btn-secondary audit-restore" data-id="${escapeHtml(entry.id)}">${t("ui.diesen_stand_wiederherstellen")}</button></div>`
              : ""
          }
          ${
            rows.length === 0
              ? `<p class="empty-note">${t("ui.keine_inhaltlichen_feldaenderungen_erkennbar")}</p>`
              : `<table>
                  <thead><tr><th>${t("ui.feld")}</th><th>${t("ui.vorher")}</th><th>${t("ui.nachher")}</th></tr></thead>
                  <tbody>
                    ${rows
                      .map(
                        (r) =>
                          `<tr><td>${escapeHtml(r.key)}</td><td>${formatValue(r.oldVal)}</td><td>${formatValue(r.newVal)}</td></tr>`
                      )
                      .join("")}
                  </tbody>
                </table>`
          }
        </details>
      `;
    })
    .join("");
}

// Baut den Bestätigungstext: was sich durch das Wiederherstellen ändert.
export function bestaetigungsText(entry, alterStand) {
  const name = alterStand.name;
  const aktuell =
    entry.table_name === "recipes"
      ? loadRecipes().find((r) => r.name === name)
      : loadProducts().find((p) => p.name === name);

  const zeilen = [];
  Object.keys(alterStand).forEach((feld) => {
    if (feld === "id") return;
    const jetzt = aktuell?.[feld];
    const zurueck = alterStand[feld];
    if (JSON.stringify(jetzt ?? "") === JSON.stringify(zurueck ?? "")) return;
    const kurz = (v) => {
      const kurz = v === null || v === undefined || v === "" ? "–" : JSON.stringify(v);
      return kurz.length > 60 ? kurz.slice(0, 57) + "…" : kurz;
    };
    zeilen.push(`  ${feld}: ${kurz(jetzt)}  ->  ${kurz(zurueck)}`);
  });

  const teile = [`"${name}${t("ui.auf_den_stand_von_diesem_eintrag_dc11")}`, ""];
  teile.push(zeilen.length > 0 ? zeilen.join("\n") : t("ui.keine_unterschiede_zum_aktuellen_stand"));

  // Umbenennung: Wiederherstellen legt den alten Namen wieder an, der neue
  // bleibt daneben stehen. Das muss man vorher wissen.
  const neuerName = entry.new_data?.name;
  if (entry.action === "update" && neuerName && neuerName !== name) {
    teile.push(
      "",
      `${t("ui.achtung_der_eintrag_wurde_in")}${neuerName}" umbenannt.`,
      `${t("ui.wiederherstellen_legt")}${name}${t("ui.wieder_an")}${neuerName}${t("ui.bleibt_bestehen")}`,
      t("ui.und_muss_danach_von_hand_geloescht_werden")
    );
  }
  if (entry.action === "delete") {
    teile.push("", t("ui.der_geloeschte_eintrag_wird_neu_angelegt"));
  }
  return teile.join("\n");
}

async function handleRestore(id) {
  const entry = entriesCache.find((e) => e.id === id);
  if (!entry || !isAdmin() || !istWiederherstellbar(entry)) return;

  const alterStand =
    entry.table_name === "recipes" ? fromRecipeRow(entry.old_data) : fromProductRow(entry.old_data);

  if (!confirm(bestaetigungsText(entry, alterStand))) return;

  try {
    // Über die normale Speicherfunktion: so landet auch die
    // Wiederherstellung selbst wieder im Änderungsverlauf.
    await RESTORABLE_TABLES[entry.table_name](alterStand);
    alert(`"${alterStand.name}${t("ui.wurde_wiederhergestellt")}`);
    await loadAuditLog();
  } catch (error) {
    alert(t("ui.wiederherstellen_fehlgeschlagen") + error.message);
  }
}

export function initAuditLog() {
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(loadAuditLog);

  listEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".audit-restore");
    if (btn) handleRestore(btn.dataset.id);
  });
  filterEl.addEventListener("change", loadAuditLog);
  dateFilterEl.addEventListener("change", loadAuditLog);
  sectionEl.addEventListener("toggle", () => {
    if (sectionEl.open && !loaded) {
      loaded = true;
      loadAuditLog();
    }
  });
}
