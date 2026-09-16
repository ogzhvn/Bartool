import {
  deleteQuizQuestion,
  loadQuizQuestions,
  onQuizQuestionsChanged,
  saveQuizQuestion,
} from "./storage.js";
import { syncGeneratedQuestions } from "./quizSync.js";
import { initQuizTable, render as renderQuizTable } from "./quizTable.js";
import { getAllProducts } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { onLanguageChanged, t } from "./i18n.js";

// Quiz-Fragen pflegen (Sub-Tab "admin-quiz").
//
// Seit September 2026 stehen *alle* Fragen in der Tabelle quiz_questions,
// auch die aus dem Katalog erzeugten (js/quizSync.js schreibt sie dorthin).
// Dieser Bereich besteht deshalb aus zwei Teilen:
//
//   - der Fragentabelle (js/quizTable.js) in der Optik der Katalogtabelle:
//     suchen, filtern, sortieren, anklicken;
//   - diesem Formular, in dem die angeklickte Frage landet und in dem neue
//     kuratierte Fragen entstehen – Servicewissen, Hausregeln, Prüfungsstoff,
//     also alles, was in keinem Produktfeld steht.
//
// Vor dem Speichern gibt es eine Vorschau in genau der Form, in der die Frage
// später im Quiz erscheint.

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
const quizDeleteBtn = document.getElementById("quiz-admin-delete");
const quizSyncBtn = document.getElementById("quiz-admin-sync");
const quizSyncNoteEl = document.getElementById("quiz-admin-sync-note");

// Frage, die gerade bearbeitet wird (null = neue Frage). Die ganze Zeile,
// weil Schlüssel, Quelle und Oberthema beim Speichern erhalten bleiben
// müssen – sonst verliert eine Generatorfrage ihren Bezug zu den Versuchen.
let quizEditRow = null;

function quizSetSyncNote(text) {
  if (!quizSyncNoteEl) return;
  quizSyncNoteEl.hidden = !text;
  quizSyncNoteEl.textContent = text ?? "";
}

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
  input.placeholder = t("ui.antwortmoeglichkeit");

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "btn-secondary";
  removeBtn.textContent = t("ui.entfernen");
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
    id: quizEditRow?.id ?? "",
    questionKey: quizEditRow?.questionKey ?? "",
    source: quizEditRow?.source ?? "kuratiert",
    parentTopic: quizEditRow?.parentTopic ?? "",
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
  if (!frage.question) return t("ui.die_frage_fehlt");
  if (frage.options.length < 2) return t("ui.es_braucht_mindestens_zwei_ausgefuellte_c627");
  if (new Set(frage.options.map((o) => o.toLowerCase())).size !== frage.options.length)
    return t("ui.zwei_antworten_sind_identisch");
  if (frage.correctIndex < 0) return t("ui.es_ist_keine_richtige_antwort_markiert");
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
  titel.textContent = `${frage.topic || t("ui.servicewissen")} ${t("ui.hauswissen")}`;
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
  quizEditRow = null;
  if (quizDeleteBtn) quizDeleteBtn.hidden = true;
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
  quizEditRow = row;
  if (quizDeleteBtn) quizDeleteBtn.hidden = false;
  quizQuestionEl.value = row.question ?? "";
  quizTopicEl.value = row.topic ?? "";
  quizDifficultyEl.value = String(row.difficulty ?? 2);
  quizExplanationEl.value = row.explanation ?? "";
  quizRefProductEl.value = row.refProduct ?? "";
  quizRefRecipeEl.value = row.refRecipe ?? "";
  quizActiveEl.checked = row.active !== false;
  quizOptionsEl.textContent = "";
  const optionen = Array.isArray(row.options) ? row.options : [];
  optionen.forEach((option, i) => quizAddOptionRow(String(option ?? ""), i === Number(row.correctIndex)));
  if (optionen.length < 2) quizAddOptionRow();
  quizPreviewBox.hidden = true;
  quizSetError("");
  quizQuestionEl.scrollIntoView({ block: "center" });
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
    await saveQuizQuestion(frage);
  } catch (error) {
    quizSetError(t("ui.frage_konnte_nicht_gespeichert_werden") + error.message);
    return;
  }
  quizResetForm();
  renderQuizTable();
}

async function quizHandleDelete() {
  if (!quizEditRow) return;
  if (!confirm(t("ui.diese_frage_wirklich_loeschen"))) return;
  try {
    await deleteQuizQuestion(quizEditRow.id);
  } catch (error) {
    quizSetError(t("ui.frage_konnte_nicht_geloescht_werden") + error.message);
    return;
  }
  quizResetForm();
  renderQuizTable();
}

// Katalog-Abgleich. Läuft über js/quizSync.js und kann ein paar Sekunden
// dauern – währenddessen bleibt der Knopf gesperrt, damit niemand zwei Läufe
// übereinanderlegt.
async function quizHandleSync() {
  if (!quizSyncBtn) return;
  quizSyncBtn.disabled = true;
  quizSetSyncNote(t("ui.abgleich_laeuft"));
  try {
    const bilanz = await syncGeneratedQuestions();
    quizSetSyncNote(
      `${t("ui.abgleich_fertig")} ${bilanz.neu} ${t("ui.neu_klein")} · ` +
        `${bilanz.geaendert} ${t("ui.aktualisiert_klein")} · ` +
        `${bilanz.stillgelegt} ${t("ui.stillgelegt")} · ` +
        `${bilanz.wiederbelebt} ${t("ui.wieder_aktiviert")} · ` +
        `${bilanz.uebersprungen} ${t("ui.von_hand_geaendert_uebersprungen")}`
    );
  } catch (error) {
    quizSetSyncNote(t("ui.abgleich_fehlgeschlagen") + error.message);
  }
  quizSyncBtn.disabled = false;
  renderQuizTable();
}

export function initAdminQuiz() {
  quizAddOptionBtn.addEventListener("click", () => quizAddOptionRow());
  quizPreviewBtn.addEventListener("click", quizRenderPreview);
  quizResetBtn.addEventListener("click", quizResetForm);
  quizDeleteBtn?.addEventListener("click", quizHandleDelete);
  quizSyncBtn?.addEventListener("click", quizHandleSync);
  quizForm.addEventListener("submit", quizHandleSubmit);

  quizResetForm();
  quizFillDatalists();
  initQuizTable(quizLoadIntoForm);

  // Die Datalists hängen am Katalog, nicht an den Fragen – sie werden nur
  // einmal gefüllt und bei Sprachwechsel nicht angefasst.
  onLanguageChanged(() => {
    quizResetForm();
  });

  // Fragen, die woanders geändert wurden (anderer Browser, Sync-Lauf): das
  // offene Formular bleibt stehen, damit niemandem die halbe Eingabe wegfliegt.
  onQuizQuestionsChanged(() => {
    if (!quizEditRow) return;
    const aktuell = loadQuizQuestions().find((zeile) => zeile.id === quizEditRow.id);
    if (!aktuell) quizResetForm();
  });
}
