import { getSupabaseClient } from "./supabaseClient.js";
import { getCurrentUser } from "./auth.js";
import { saveRecipe, saveProduct } from "./storage.js";
import { escapeHtml } from "./utils.js";

const pendingListEl = document.getElementById("change-requests-list");
const myWrapperEl = document.getElementById("my-change-requests-wrapper");
const myListEl = document.getElementById("my-change-requests-list");

const TABLE_LABELS = { recipes: "Rezept", products: "Produkt" };
const STATUS_LABELS = { pending: "wird geprüft", approved: "übernommen", rejected: "abgelehnt" };

// Von den Bearbeiten-Formularen (recipes.js/products.js) aufgerufen, wenn
// eine nicht-Admin-Person eine Änderung einreicht – RLS erlaubt Mitarbeitern
// ohnehin keinen direkten Schreibzugriff auf recipes/products.
export async function submitChangeRequest(tableName, payload) {
  const supabase = getSupabaseClient();
  const user = getCurrentUser();
  const { error } = await supabase.from("change_requests").insert({
    table_name: tableName,
    payload,
    proposed_by: user.id,
  });
  if (error) throw error;
}

function renderPayload(payload) {
  return Object.entries(payload)
    .filter(([key, value]) => key !== "name" && value !== "" && value != null && !(Array.isArray(value) && value.length === 0))
    .map(([key, value]) => {
      const display = Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : String(value);
      return `<p><strong>${escapeHtml(key)}:</strong> ${escapeHtml(display)}</p>`;
    })
    .join("");
}

async function approveRequest(entry) {
  try {
    if (entry.table_name === "recipes") {
      await saveRecipe(entry.payload);
    } else {
      await saveProduct(entry.payload);
    }
    const supabase = getSupabaseClient();
    const { error } = await supabase
      .from("change_requests")
      .update({ status: "approved", reviewed_by: getCurrentUser().id, reviewed_at: new Date().toISOString() })
      .eq("id", entry.id);
    if (error) throw error;
    await loadPending();
  } catch (error) {
    alert("Vorschlag konnte nicht übernommen werden: " + error.message);
  }
}

async function rejectRequest(entry) {
  const comment = prompt("Kommentar zur Ablehnung (optional):", "");
  if (comment === null) return;
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("change_requests")
    .update({ status: "rejected", review_comment: comment || null, reviewed_by: getCurrentUser().id, reviewed_at: new Date().toISOString() })
    .eq("id", entry.id);
  if (error) {
    alert("Vorschlag konnte nicht abgelehnt werden: " + error.message);
    return;
  }
  await loadPending();
}

function renderPending(entries) {
  if (entries.length === 0) {
    pendingListEl.innerHTML = `<p class="empty-note">Keine offenen Vorschläge.</p>`;
    return;
  }
  pendingListEl.innerHTML = "";
  entries.forEach((entry) => {
    const who = entry.proposer?.display_name || entry.proposer?.username || "unbekannt";
    const when = new Date(entry.created_at).toLocaleString("de-DE");
    const tableLabel = TABLE_LABELS[entry.table_name] ?? entry.table_name;

    const item = document.createElement("details");
    item.className = "audit-entry";
    item.innerHTML = `
      <summary>${escapeHtml(when)} · ${escapeHtml(tableLabel)} „${escapeHtml(entry.payload?.name ?? "")}“ · von ${escapeHtml(who)}</summary>
      <div class="recipe-item-body">${renderPayload(entry.payload ?? {})}</div>
      <div class="actions">
        <button type="button" class="btn-primary approve-btn">Annehmen</button>
        <button type="button" class="btn-secondary reject-btn">Ablehnen</button>
      </div>
    `;
    item.querySelector(".approve-btn").addEventListener("click", () => approveRequest(entry));
    item.querySelector(".reject-btn").addEventListener("click", () => rejectRequest(entry));
    pendingListEl.appendChild(item);
  });
}

async function loadPending() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("change_requests")
    .select("*, proposer:profiles!change_requests_proposed_by_fkey(username, display_name)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) {
    pendingListEl.innerHTML = `<p class="empty-note">Vorschläge konnten nicht geladen werden: ${escapeHtml(error.message)}</p>`;
    return;
  }
  renderPending(data ?? []);
}

function renderMine(entries) {
  if (entries.length === 0) {
    myWrapperEl.hidden = true;
    myListEl.innerHTML = "";
    return;
  }
  myWrapperEl.hidden = false;
  myListEl.innerHTML = entries
    .map((entry) => {
      const tableLabel = TABLE_LABELS[entry.table_name] ?? entry.table_name;
      const when = new Date(entry.created_at).toLocaleString("de-DE");
      const statusLabel = STATUS_LABELS[entry.status] ?? entry.status;
      const comment = entry.status === "rejected" && entry.review_comment ? ` – ${escapeHtml(entry.review_comment)}` : "";
      return `<p><strong>${escapeHtml(tableLabel)} „${escapeHtml(entry.payload?.name ?? "")}“</strong> (${escapeHtml(when)}): ${escapeHtml(statusLabel)}${comment}</p>`;
    })
    .join("");
}

async function loadMine() {
  const user = getCurrentUser();
  if (!user) return;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("change_requests")
    .select("*")
    .eq("proposed_by", user.id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return;
  renderMine(data ?? []);
}

export function initChangeRequestsAdmin() {
  loadPending();
}

export function initMyChangeRequests() {
  loadMine();
}
