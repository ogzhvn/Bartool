import { can } from "./auth.js";
import { getSupabaseClient } from "./supabaseClient.js";
import { loadCuratedQuestionRows, saveCuratedQuestion, deleteCuratedQuestion } from "./quiz.js";
import { getAllProducts } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { formatDate, onLanguageChanged, t } from "./i18n.js";

// Quiz-Fragen pflegen und Team-Übersicht (Sub-Tab "admin-quiz").
// Aus js/adminPanel.js herausgelöst (Paket 34) – der Inhalt ist unverändert.
// Die Team-Übersicht zieht laut Ausbauplan erst in Paket 37 unter Reporting um.
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
    p.textContent = t("ui.noch_keine_kuratierten_fragen_der_c7a4");
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
    meta.textContent = `${row.topic ?? ""} · ${optionen.length} ${t("ui.antworten")}${row.active === false ? " · inaktiv" : ""}`;
    item.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-secondary";
    editBtn.textContent = t("ui.bearbeiten");
    editBtn.addEventListener("click", () => quizLoadIntoForm(row));
    actions.appendChild(editBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn-secondary";
    deleteBtn.textContent = t("ui.loeschen");
    deleteBtn.addEventListener("click", async () => {
      if (!confirm(t("ui.diese_frage_wirklich_loeschen"))) return;
      try {
        await deleteCuratedQuestion(row.id);
      } catch (error) {
        quizSetError(t("ui.frage_konnte_nicht_geloescht_werden") + error.message);
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
    p.textContent = t("ui.fragen_konnten_nicht_geladen_werden") + error.message;
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
    quizSetError(t("ui.frage_konnte_nicht_gespeichert_werden") + error.message);
    return;
  }
  quizResetForm();
  quizLoadQuestions();
}

// ---------------------------------------------------------------------
// Quiz: Team-Übersicht und Themen-Heatmap (Paket 27)
//
// Beide Listen kommen aus SECURITY-DEFINER-Funktionen, die selbst auf Admin
// prüfen und ausschließlich Summen zurückgeben. Auf die Tabelle
// quiz_attempts hat auch ein Admin keinen Lesezugriff – einzelne Antworten
// einer Person bleiben deren Sache.
// ---------------------------------------------------------------------

const teamRefreshBtn = document.getElementById("quiz-team-refresh");
const teamErrorEl = document.getElementById("quiz-team-error");
const teamListEl = document.getElementById("quiz-team-list");
const teamHeatmapEl = document.getElementById("quiz-team-heatmap");

function teamSetError(text) {
  teamErrorEl.hidden = !text;
  teamErrorEl.textContent = text ?? "";
}

function teamEmptyNote(container, text) {
  container.textContent = "";
  const p = document.createElement("p");
  p.className = "empty-note";
  p.textContent = text;
  container.appendChild(p);
}

function teamQuoteBar(prozent) {
  const balken = document.createElement("span");
  balken.className = "quiz-quota-bar";
  const fuellung = document.createElement("span");
  fuellung.className =
    prozent >= 80 ? "quiz-quota-fill is-good" : prozent >= 50 ? "quiz-quota-fill" : "quiz-quota-fill is-weak";
  fuellung.style.width = `${Math.max(2, prozent)}%`;
  balken.appendChild(fuellung);
  return balken;
}

function teamPersonName(row) {
  const name = String(row.display_name ?? "").trim();
  if (name) return name;
  // Ohne Anzeigenamen bleibt nur die Mailadresse als Kennung.
  return String(row.email ?? "").trim() || t("ui.unbekannt");
}

function teamRenderOverview(rows) {
  teamListEl.textContent = "";
  const aktiv = rows.filter((row) => Number(row.attempts ?? 0) > 0);
  if (aktiv.length === 0) {
    teamEmptyNote(teamListEl, t("ui.noch_hat_niemand_eine_quizrunde_gespielt"));
    return;
  }

  aktiv.forEach((row) => {
    const item = document.createElement("div");
    item.className = "quiz-team-item";

    const kopf = document.createElement("div");
    kopf.className = "quiz-team-head";

    const name = document.createElement("span");
    name.className = "quiz-team-name";
    name.textContent = teamPersonName(row);
    kopf.appendChild(name);

    const quote = Number(row.accuracy ?? 0);
    const quoteEl = document.createElement("span");
    quoteEl.className = "quiz-quota-value";
    quoteEl.textContent = `${quote} %`;
    kopf.appendChild(quoteEl);
    item.appendChild(kopf);

    item.appendChild(teamQuoteBar(quote));

    const runden = Number(row.rounds ?? 0);
    const versuche = Number(row.attempts ?? 0);
    const richtig = Number(row.correct ?? 0);
    const meta = document.createElement("p");
    meta.className = "quiz-team-meta";
    const zuletzt = row.last_answered_at ? new Date(row.last_answered_at) : null;
    const zuletztText =
      zuletzt && !Number.isNaN(zuletzt.getTime())
        ? ` · ${t("ui.zuletzt")} ${formatDate(zuletzt)}`
        : "";
    meta.textContent = `${runden} ${runden === 1 ? t("ui.runde") : t("ui.runden")} · ${richtig} ${t("ui.von")} ${versuche} ${t("ui.fragen_richtig_71e0")}${zuletztText}`;
    item.appendChild(meta);

    const schwach = Array.isArray(row.weakest_topics) ? row.weakest_topics : [];
    const themen = document.createElement("p");
    themen.className = "quiz-team-topics";
    themen.textContent =
      schwach.length === 0
        ? t("ui.schwaechste_themen_noch_zu_wenige_dada")
        : t("ui.schwaechste_themen") +
          schwach.map((thema) => `${thema.topic} (${thema.accuracy} %, ${thema.attempts} ${t("ui.fragen")}`).join(" · ");
    item.appendChild(themen);

    teamListEl.appendChild(item);
  });
}

function teamRenderHeatmap(rows) {
  teamHeatmapEl.textContent = "";
  if (rows.length === 0) {
    teamEmptyNote(teamHeatmapEl, t("ui.noch_keine_antworten_die_heatmap_fuellt_9261"));
    return;
  }
  rows.forEach((row) => {
    const zeile = document.createElement("div");
    zeile.className = "quiz-quota-row";

    const kopf = document.createElement("span");
    kopf.className = "quiz-quota-head";
    const label = document.createElement("span");
    label.className = "quiz-quota-label";
    label.textContent = row.topic ?? "";
    const wert = document.createElement("span");
    wert.className = "quiz-quota-value";
    wert.textContent = `${Number(row.accuracy ?? 0)} %`;
    kopf.appendChild(label);
    kopf.appendChild(wert);
    zeile.appendChild(kopf);

    zeile.appendChild(teamQuoteBar(Number(row.accuracy ?? 0)));

    const lernende = Number(row.learners ?? 0);
    const meta = document.createElement("span");
    meta.className = "quiz-quota-meta";
    meta.textContent = `${Number(row.correct ?? 0)} ${t("ui.von")} ${Number(row.attempts ?? 0)} ${t("ui.fragen_richtig")} ${lernende} ${lernende === 1 ? t("ui.person") : t("ui.personen")}`;
    zeile.appendChild(meta);

    teamHeatmapEl.appendChild(zeile);
  });
}

async function teamLoad() {
  teamSetError("");
  const supabase = getSupabaseClient();
  try {
    const [uebersicht, heatmap] = await Promise.all([
      supabase.rpc("quiz_team_overview"),
      supabase.rpc("quiz_topic_heatmap"),
    ]);
    if (uebersicht.error) throw uebersicht.error;
    if (heatmap.error) throw heatmap.error;
    teamRenderOverview(uebersicht.data ?? []);
    teamRenderHeatmap(heatmap.data ?? []);
  } catch (error) {
    teamSetError(t("ui.die_team_auswertung_konnte_nicht_geladen_34c6") + error.message);
    teamEmptyNote(teamListEl, t("ui.keine_daten_geladen"));
    teamEmptyNote(teamHeatmapEl, t("ui.keine_daten_geladen"));
  }
}

function initQuizTeam() {
  teamRefreshBtn.addEventListener("click", teamLoad);
  // Die Team-Auswertung hängt an reports.view, nicht an quiz.manage: Zahlen
  // über das Team sind eine Auswertung, keine Fragenpflege (Paket 36, in
  // Paket 37 zieht dieser Block ins Reporting um). Ohne das Recht gäbe der
  // RPC-Aufruf einen Rechtefehler zurück – also gar nicht erst anfragen.
  if (can("reports.view")) teamLoad();
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

export function initAdminQuiz() {
  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(() => {
    quizResetForm();
    quizLoadQuestions();
    if (can("reports.view")) teamLoad();
  });

  initQuizAdmin();
  initQuizTeam();
}
