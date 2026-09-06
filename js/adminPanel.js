import { getSupabaseClient } from "./supabaseClient.js";
import { getCurrentUser } from "./auth.js";
import { escapeHtml, functionErrorMessage } from "./utils.js";
import { loadCuratedQuestionRows, saveCuratedQuestion, deleteCuratedQuestion } from "./quiz.js";
import { getAllProducts } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";

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
      <thead><tr><th>Benutzername</th><th>E-Mail</th><th>Name</th><th>Rolle</th><th></th></tr></thead>
      <tbody>
        ${profiles
          .map(
            (p) => `
          <tr data-id="${p.id}">
            <td><input type="text" class="username-input" value="${escapeHtml(p.username ?? "")}" pattern="[a-z0-9._-]{3,32}" /></td>
            <td>${escapeHtml(p.email)}</td>
            <td>${escapeHtml(p.display_name ?? "")}</td>
            <td>
              <select class="role-select" ${p.id === getCurrentUser()?.id ? "disabled" : ""}>
                <option value="mitarbeiter" ${p.role === "mitarbeiter" ? "selected" : ""}>Mitarbeiter</option>
                <option value="admin" ${p.role === "admin" ? "selected" : ""}>Admin</option>
              </select>
            </td>
            <td>
              <button type="button" class="btn-secondary reset-password-btn" ${p.id === getCurrentUser()?.id ? "disabled" : ""}>Passwort zurücksetzen</button>
              <button type="button" class="btn-secondary delete-employee-btn" ${p.id === getCurrentUser()?.id ? "disabled" : ""}>Löschen</button>
            </td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;

  employeeListEl.querySelectorAll(".username-input").forEach((input) => {
    input.addEventListener("change", async (e) => {
      const id = e.target.closest("tr").dataset.id;
      const username = e.target.value.trim().toLowerCase();
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
        alert("Benutzername darf nur Kleinbuchstaben, Zahlen, Punkt, Unterstrich und Bindestrich enthalten (3–32 Zeichen).");
        loadEmployees();
        return;
      }
      const supabase = getSupabaseClient();
      const { error } = await supabase.from("profiles").update({ username }).eq("id", id);
      if (error) {
        alert(
          "Benutzername konnte nicht geändert werden: " +
            (error.message.includes("profiles_username_key") ? "Dieser Benutzername ist bereits vergeben." : error.message)
        );
        loadEmployees();
      }
    });
  });

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

  employeeListEl.querySelectorAll(".reset-password-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.closest("tr").dataset.id;
      const password = prompt("Neues temporäres Passwort (mind. 8 Zeichen):");
      if (password === null) return;
      if (password.length < 8) {
        alert("Das Passwort muss mindestens 8 Zeichen haben.");
        return;
      }
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.functions.invoke("admin-users", {
        body: { action: "reset-password", userId: id, password },
      });
      if (error || data?.error) {
        alert("Passwort konnte nicht zurückgesetzt werden: " + (await functionErrorMessage(error, data)));
        return;
      }
      alert("Passwort wurde zurückgesetzt. Die Person muss beim nächsten Login ein neues Passwort setzen.");
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
        alert("Konto konnte nicht gelöscht werden: " + (await functionErrorMessage(error, data)));
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
  const username = document.getElementById("admin-new-username").value.trim().toLowerCase();
  const password = document.getElementById("admin-new-password").value;
  const displayName = document.getElementById("admin-new-name").value.trim();
  const role = document.getElementById("admin-new-role").value;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.functions.invoke("admin-users", {
    body: { action: "create", email, username, password, displayName, role },
  });

  if (error || data?.error) {
    createError.hidden = false;
    createError.textContent = "Konto konnte nicht angelegt werden: " + (await functionErrorMessage(error, data));
    return;
  }

  createForm.reset();
  loadEmployees();
}

// ---------------------------------------------------------------------
// Kuratierte Quiz-Fragen (Paket 26)
//
// Der Generator deckt alles ab, was in Produkt- und Rezeptfeldern steht.
// Hier kommt dazu, was nirgends als Feld existiert: Servicewissen,
// Hausregeln, Prüfungsstoff. Vor dem Speichern gibt es eine Vorschau in
// genau der Form, in der die Frage später im Quiz erscheint.
// ---------------------------------------------------------------------

const quizForm = document.getElementById("quiz-admin-form");
const quizQuestionEl = document.getElementById("quiz-admin-question");
const quizTopicEl = document.getElementById("quiz-admin-topic");
const quizDifficultyEl = document.getElementById("quiz-admin-difficulty");
const quizOptionsEl = document.getElementById("quiz-admin-options");
const quizAddOptionBtn = document.getElementById("quiz-admin-add-option");
const quizExplanationEl = document.getElementById("quiz-admin-explanation");
const quizRefProductEl = document.getElementById("quiz-admin-ref-product");
const quizRefRecipeEl = document.getElementById("quiz-admin-ref-recipe");
const quizProductListEl = document.getElementById("quiz-admin-product-list");
const quizRecipeListEl = document.getElementById("quiz-admin-recipe-list");
const quizActiveEl = document.getElementById("quiz-admin-active");
const quizErrorEl = document.getElementById("quiz-admin-error");
const quizPreviewBtn = document.getElementById("quiz-admin-preview");
const quizPreviewBox = document.getElementById("quiz-admin-preview-box");
const quizResetBtn = document.getElementById("quiz-admin-reset");
const quizListEl = document.getElementById("quiz-admin-list");

// id der Frage, die gerade bearbeitet wird (leer = neue Frage).
let quizEditId = "";

function quizSetError(text) {
  quizErrorEl.hidden = !text;
  quizErrorEl.textContent = text ?? "";
}

// Eine Antwortzeile: Radio (= richtige Antwort) + Text + Entfernen.
function quizAddOptionRow(value = "", checked = false) {
  const row = document.createElement("div");
  row.className = "field-row quiz-admin-option-row";

  const radioLabel = document.createElement("label");
  radioLabel.className = "radio-label";
  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "quiz-admin-correct";
  radio.checked = checked;
  radioLabel.appendChild(radio);
  radioLabel.appendChild(document.createTextNode(" richtig"));

  const input = document.createElement("input");
  input.type = "text";
  input.className = "quiz-admin-option-input";
  input.value = value;
  input.placeholder = "Antwortmöglichkeit";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn-secondary";
  removeBtn.textContent = "Entfernen";
  removeBtn.addEventListener("click", () => {
    if (quizOptionsEl.children.length <= 2) return;
    row.remove();
  });

  row.appendChild(radioLabel);
  row.appendChild(input);
  row.appendChild(removeBtn);
  quizOptionsEl.appendChild(row);
}

function quizReadForm() {
  const rows = [...quizOptionsEl.querySelectorAll(".quiz-admin-option-row")];
  const options = [];
  let correctIndex = -1;
  rows.forEach((row) => {
    const wert = row.querySelector(".quiz-admin-option-input").value.trim();
    if (!wert) return;
    if (row.querySelector('input[type="radio"]').checked) correctIndex = options.length;
    options.push(wert);
  });
  return {
    id: quizEditId,
    question: quizQuestionEl.value.trim(),
    options,
    correctIndex,
    explanation: quizExplanationEl.value.trim(),
    topic: quizTopicEl.value.trim(),
    difficulty: Number(quizDifficultyEl.value) || 2,
    refProduct: quizRefProductEl.value.trim(),
    refRecipe: quizRefRecipeEl.value.trim(),
    active: quizActiveEl.checked,
  };
}

function quizValidate(frage) {
  if (!frage.question) return "Die Frage fehlt.";
  if (frage.options.length < 2) return "Es braucht mindestens zwei ausgefüllte Antwortmöglichkeiten.";
  if (new Set(frage.options.map((o) => o.toLowerCase())).size !== frage.options.length)
    return "Zwei Antworten sind identisch.";
  if (frage.correctIndex < 0) return "Es ist keine richtige Antwort markiert.";
  return "";
}

// Vorschau in derselben Form wie im Quiz – alles per textContent.
function quizRenderPreview() {
  const frage = quizReadForm();
  const fehler = quizValidate(frage);
  quizSetError(fehler);
  if (fehler) {
    quizPreviewBox.hidden = true;
    return false;
  }

  quizPreviewBox.textContent = "";
  const titel = document.createElement("p");
  titel.className = "quiz-topic-label";
  titel.textContent = `${frage.topic || "Servicewissen"} · Hauswissen`;
  quizPreviewBox.appendChild(titel);

  const text = document.createElement("p");
  text.className = "quiz-question";
  text.textContent = frage.question;
  quizPreviewBox.appendChild(text);

  const optionen = document.createElement("div");
  optionen.className = "quiz-options";
  frage.options.forEach((option, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = i === frage.correctIndex ? "quiz-option is-correct" : "quiz-option";
    btn.disabled = true;
    btn.textContent = option;
    optionen.appendChild(btn);
  });
  quizPreviewBox.appendChild(optionen);

  if (frage.explanation) {
    const erklaerung = document.createElement("p");
    erklaerung.className = "quiz-feedback-explanation";
    erklaerung.textContent = frage.explanation;
    quizPreviewBox.appendChild(erklaerung);
  }

  quizPreviewBox.hidden = false;
  return true;
}

function quizResetForm() {
  quizEditId = "";
  quizForm.reset();
  quizOptionsEl.textContent = "";
  quizAddOptionRow("", true);
  quizAddOptionRow();
  quizAddOptionRow();
  quizAddOptionRow();
  quizPreviewBox.hidden = true;
  quizSetError("");
}

function quizLoadIntoForm(row) {
  quizEditId = row.id;
  quizQuestionEl.value = row.question ?? "";
  quizTopicEl.value = row.topic ?? "";
  quizDifficultyEl.value = String(row.difficulty ?? 2);
  quizExplanationEl.value = row.explanation ?? "";
  quizRefProductEl.value = row.ref_product ?? "";
  quizRefRecipeEl.value = row.ref_recipe ?? "";
  quizActiveEl.checked = row.active !== false;
  quizOptionsEl.textContent = "";
  const optionen = Array.isArray(row.options) ? row.options : [];
  optionen.forEach((option, i) => quizAddOptionRow(String(option ?? ""), i === Number(row.correct_index)));
  if (optionen.length < 2) quizAddOptionRow();
  quizPreviewBox.hidden = true;
  quizSetError("");
  quizQuestionEl.scrollIntoView({ block: "center" });
}

function quizRenderList(rows) {
  quizListEl.textContent = "";
  if (rows.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-note";
    p.textContent = "Noch keine kuratierten Fragen. Der Generator liefert trotzdem Fragen aus dem Katalog.";
    quizListEl.appendChild(p);
    return;
  }
  rows.forEach((row) => {
    const item = document.createElement("div");
    item.className = "quiz-admin-item";

    const kopf = document.createElement("p");
    kopf.className = "quiz-admin-item-question";
    kopf.textContent = row.question ?? "";
    item.appendChild(kopf);

    const meta = document.createElement("p");
    meta.className = "quiz-admin-item-meta";
    const optionen = Array.isArray(row.options) ? row.options : [];
    meta.textContent = `${row.topic ?? ""} · ${optionen.length} Antworten${row.active === false ? " · inaktiv" : ""}`;
    item.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-secondary";
    editBtn.textContent = "Bearbeiten";
    editBtn.addEventListener("click", () => quizLoadIntoForm(row));
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-secondary";
    deleteBtn.textContent = "Löschen";
    deleteBtn.addEventListener("click", async () => {
      if (!confirm("Diese Frage wirklich löschen?")) return;
      try {
        await deleteCuratedQuestion(row.id);
      } catch (error) {
        quizSetError("Frage konnte nicht gelöscht werden: " + error.message);
        return;
      }
      if (quizEditId === row.id) quizResetForm();
      quizLoadQuestions();
    });
    actions.appendChild(deleteBtn);

    item.appendChild(actions);
    quizListEl.appendChild(item);
  });
}

async function quizLoadQuestions() {
  try {
    quizRenderList(await loadCuratedQuestionRows());
  } catch (error) {
    quizListEl.textContent = "";
    const p = document.createElement("p");
    p.className = "empty-note";
    p.textContent = "Fragen konnten nicht geladen werden: " + error.message;
    quizListEl.appendChild(p);
  }
}

function quizFillDatalists() {
  const fuellen = (listEl, namen) => {
    listEl.textContent = "";
    namen.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      listEl.appendChild(option);
    });
  };
  fuellen(quizProductListEl, getAllProducts().map((p) => p.name));
  fuellen(quizRecipeListEl, getAllRecipes().map((r) => r.name));
}

async function quizHandleSubmit(e) {
  e.preventDefault();
  const frage = quizReadForm();
  const fehler = quizValidate(frage);
  if (fehler) {
    quizSetError(fehler);
    return;
  }
  try {
    await saveCuratedQuestion(frage);
  } catch (error) {
    quizSetError("Frage konnte nicht gespeichert werden: " + error.message);
    return;
  }
  quizResetForm();
  quizLoadQuestions();
}

function initQuizAdmin() {
  quizAddOptionBtn.addEventListener("click", () => quizAddOptionRow());
  quizPreviewBtn.addEventListener("click", quizRenderPreview);
  quizResetBtn.addEventListener("click", quizResetForm);
  quizForm.addEventListener("submit", quizHandleSubmit);
  quizResetForm();
  quizFillDatalists();
  quizLoadQuestions();
}

export function initAdminPanel() {
  createForm.addEventListener("submit", handleCreate);
  loadEmployees();
  initQuizAdmin();
}
