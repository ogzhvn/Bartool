import { getSupabaseClient } from "./supabaseClient.js";
import { getCurrentUser } from "./auth.js";
import { escapeHtml } from "./utils.js";

const createForm = document.getElementById("admin-create-form");
const createError = document.getElementById("admin-create-error");
const employeeListEl = document.getElementById("admin-employee-list");

async function loadEmployees() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("profiles").select("*").order("email");
  if (error) {
    employeeListEl.innerHTML = `<p class="empty-note">Konten konnten nicht geladen werden: ${escapeHtml(error.message)}</p>`;
    return;
  }
  renderEmployees(data ?? []);
}

function renderEmployees(profiles) {
  if (profiles.length === 0) {
    employeeListEl.innerHTML = `<p class="empty-note">Keine Konten gefunden.</p>`;
    return;
  }

  employeeListEl.innerHTML = `
    <table>
      <thead><tr><th>E-Mail</th><th>Name</th><th>Rolle</th><th></th></tr></thead>
      <tbody>
        ${profiles
          .map(
            (p) => `
          <tr data-id="${p.id}">
            <td>${escapeHtml(p.email)}</td>
            <td>${escapeHtml(p.display_name ?? "")}</td>
            <td>
              <select class="role-select" ${p.id === getCurrentUser()?.id ? "disabled" : ""}>
                <option value="mitarbeiter" ${p.role === "mitarbeiter" ? "selected" : ""}>Mitarbeiter</option>
                <option value="admin" ${p.role === "admin" ? "selected" : ""}>Admin</option>
              </select>
            </td>
            <td><button type="button" class="btn-secondary delete-employee-btn" ${p.id === getCurrentUser()?.id ? "disabled" : ""}>Löschen</button></td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;

  employeeListEl.querySelectorAll(".role-select").forEach((select) => {
    select.addEventListener("change", async (e) => {
      const id = e.target.closest("tr").dataset.id;
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("profiles").update({ role: e.target.value }).eq("id", id);
      if (error) {
        alert("Rolle konnte nicht geändert werden: " + error.message);
        loadEmployees();
      }
    });
  });

  employeeListEl.querySelectorAll(".delete-employee-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.closest("tr").dataset.id;
      if (!confirm("Dieses Konto wirklich löschen? Der Zugriff wird sofort entzogen.")) return;
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: { action: "delete", userId: id },
      });
      if (error || data?.error) {
        alert("Konto konnte nicht gelöscht werden: " + (data?.error || error.message));
        return;
      }
      loadEmployees();
    });
  });
}

async function handleCreate(e) {
  e.preventDefault();
  createError.hidden = true;

  const email = document.getElementById("admin-new-email").value.trim();
  const password = document.getElementById("admin-new-password").value;
  const displayName = document.getElementById("admin-new-name").value.trim();
  const role = document.getElementById("admin-new-role").value;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "create", email, password, displayName, role },
  });

  if (error || data?.error) {
    createError.hidden = false;
    createError.textContent = "Konto konnte nicht angelegt werden: " + (data?.error || error.message);
    return;
  }

  createForm.reset();
  loadEmployees();
}

export function initAdminPanel() {
  createForm.addEventListener("submit", handleCreate);
  loadEmployees();
}
