import { getSupabaseClient } from "./supabaseClient.js";
import { escapeHtml } from "./utils.js";

const filterEl = document.getElementById("audit-log-filter");
const dateFilterEl = document.getElementById("audit-log-date-filter");
const sectionEl = document.getElementById("audit-log-section");
const listEl = document.getElementById("audit-log-list");

let loaded = false;

const TABLE_LABELS = { recipes: "Rezept", products: "Produkt", profiles: "Konto" };
const ACTION_LABELS = { insert: "angelegt", update: "geändert", delete: "gelöscht" };

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
    listEl.innerHTML = `<p class="empty-note">Änderungsverlauf konnte nicht geladen werden: ${escapeHtml(error.message)}</p>`;
    return;
  }
  renderAuditLog(data ?? []);
}

function renderAuditLog(entries) {
  if (entries.length === 0) {
    listEl.innerHTML = `<p class="empty-note">Keine Änderungen gefunden.</p>`;
    return;
  }

  listEl.innerHTML = entries
    .map((entry) => {
      const who = entry.changed_by_profile?.display_name || entry.changed_by_profile?.username || "System";
      const when = new Date(entry.changed_at).toLocaleString("de-DE");
      const tableLabel = TABLE_LABELS[entry.table_name] ?? entry.table_name;
      const actionLabel = ACTION_LABELS[entry.action] ?? entry.action;
      const label = entryLabel(entry);
      const rows = computeDiff(entry);

      return `
        <details class="audit-entry">
          <summary>${escapeHtml(when)} · ${escapeHtml(tableLabel)} ${escapeHtml(actionLabel)}${
        label ? " · " + escapeHtml(label) : ""
      } · ${escapeHtml(who)}</summary>
          ${
            rows.length === 0
              ? `<p class="empty-note">Keine inhaltlichen Feldänderungen erkennbar.</p>`
              : `<table>
                  <thead><tr><th>Feld</th><th>Vorher</th><th>Nachher</th></tr></thead>
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

export function initAuditLog() {
  filterEl.addEventListener("change", loadAuditLog);
  dateFilterEl.addEventListener("change", loadAuditLog);
  sectionEl.addEventListener("toggle", () => {
    if (sectionEl.open && !loaded) {
      loaded = true;
      loadAuditLog();
    }
  });
}
