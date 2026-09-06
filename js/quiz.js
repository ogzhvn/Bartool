import { getSupabaseClient } from "./supabaseClient.js";
import { getCurrentUser } from "./auth.js";
import { generateQuestions, listGeneratedTopics, pickQuestions } from "./quizGenerator.js";
import { onProductsChanged, onRecipesChanged } from "./storage.js";
import { switchTab } from "./tabs.js";
import { focusProduct } from "./products.js";
import { focusRecipe } from "./recipes.js";

// Quiz – Schulungswerkzeug fürs Barteam (Paket 26).
//
// Hybrid aus zwei Quellen:
//   - Generator (js/quizGenerator.js): Fragen aus dem geprüften Katalog.
//   - Kuratierte Fragen aus der Tabelle quiz_questions: alles, was nicht in
//     Produktfeldern steht (Servicewissen, Hausregeln, Prüfungsstoff).
//
// Fragen und Antworten werden ausschließlich per textContent gesetzt – der
// Text kommt aus Katalog und Datenbank, also aus Nutzereingaben.

const SCHNELLRUNDE = 10;
const PRUEFUNG = 25;

const startEl = document.getElementById("quiz-start");
const startNoteEl = document.getElementById("quiz-start-note");
const topicSelectEl = document.getElementById("quiz-topic");
const quickBtn = document.getElementById("quiz-start-quick");
const examBtn = document.getElementById("quiz-start-exam");
const topicBtn = document.getElementById("quiz-start-topic");

const roundEl = document.getElementById("quiz-round");
const progressTextEl = document.getElementById("quiz-progress-text");
const scoreTextEl = document.getElementById("quiz-score-text");
const progressFillEl = document.getElementById("quiz-progress-fill");
const questionTopicEl = document.getElementById("quiz-question-topic");
const questionTextEl = document.getElementById("quiz-question-text");
const optionsEl = document.getElementById("quiz-options");
const feedbackEl = document.getElementById("quiz-feedback");
const feedbackTitleEl = document.getElementById("quiz-feedback-title");
const feedbackExplanationEl = document.getElementById("quiz-feedback-explanation");
const jumpBtn = document.getElementById("quiz-jump");
const nextBtn = document.getElementById("quiz-next");
const abortBtn = document.getElementById("quiz-abort");

const resultEl = document.getElementById("quiz-result");
const resultTitleEl = document.getElementById("quiz-result-title");
const resultSummaryEl = document.getElementById("quiz-result-summary");
const resultListEl = document.getElementById("quiz-result-list");
const againBtn = document.getElementById("quiz-again");

// Kuratierte Fragen aus der DB, gecacht bis zum nächsten Rundenstart.
let curatedCache = [];
// Laufende Runde: { fragen, index, antworten: [{ frage, korrekt }] }
let runde = null;

function txt(value) {
  return String(value ?? "").trim();
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function setNote(text) {
  startNoteEl.hidden = !text;
  startNoteEl.textContent = text ?? "";
}

// ---------------------------------------------------------------------
// Kuratierte Fragen (Tabelle quiz_questions)
// ---------------------------------------------------------------------

// Wandelt eine DB-Zeile in dieselbe Form, die der Generator liefert. Fragen
// mit kaputten Daten (leere Option, correct_index außerhalb) werden
// verworfen statt halb angezeigt.
function fromQuestionRow(row) {
  const optionen = (Array.isArray(row?.options) ? row.options : []).map((o) => txt(o)).filter(Boolean);
  const index = Number(row?.correct_index);
  if (optionen.length < 2 || !Number.isInteger(index) || index < 0 || index >= optionen.length) return null;
  const richtig = optionen[index];
  const gemischt = shuffle(optionen);
  return {
    key: `db:${row.id}`,
    question: txt(row.question),
    options: gemischt,
    correctIndex: gemischt.indexOf(richtig),
    explanation: txt(row.explanation),
    topic: txt(row.topic) || "Servicewissen",
    difficulty: Number(row.difficulty) || 2,
    refProduct: txt(row.ref_product),
    refRecipe: txt(row.ref_recipe),
    source: "kuratiert",
  };
}

async function fetchCuratedQuestions({ onlyActive = true } = {}) {
  const supabase = getSupabaseClient();
  let query = supabase.from("quiz_questions").select("*").order("topic").order("question");
  if (onlyActive) query = query.eq("active", true);
  try {
    const { data, error } = await query;
    if (error) return { rows: [], error };
    return { rows: data ?? [], error: null };
  } catch (err) {
    // Offline: der Fetch wirft, statt nur `error` zu setzen. Das Quiz läuft
    // dann mit den generierten Fragen weiter.
    return { rows: [], error: err };
  }
}

// Für die Admin-Maske (js/adminPanel.js): Rohzeilen inklusive inaktiver.
export async function loadCuratedQuestionRows() {
  const { rows, error } = await fetchCuratedQuestions({ onlyActive: false });
  if (error) throw error;
  return rows;
}

export async function saveCuratedQuestion(question) {
  const supabase = getSupabaseClient();
  const nutzer = getCurrentUser();
  const payload = {
    question: txt(question.question),
    options: question.options,
    correct_index: question.correctIndex,
    explanation: txt(question.explanation),
    topic: txt(question.topic) || "Servicewissen",
    difficulty: question.difficulty,
    ref_product: txt(question.refProduct) || null,
    ref_recipe: txt(question.refRecipe) || null,
    active: question.active !== false,
  };
  if (question.id) {
    const { error } = await supabase.from("quiz_questions").update(payload).eq("id", question.id);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from("quiz_questions")
    .insert({ ...payload, created_by: nutzer?.id ?? null });
  if (error) throw error;
}

export async function deleteCuratedQuestion(id) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("quiz_questions").delete().eq("id", id);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Fragenpool
// ---------------------------------------------------------------------

async function refreshCurated() {
  const { rows } = await fetchCuratedQuestions();
  curatedCache = rows.map(fromQuestionRow).filter(Boolean);
}

function buildPool() {
  return [...generateQuestions(), ...curatedCache];
}

function renderTopics(pool) {
  const themen = listGeneratedTopics(pool);
  const vorher = topicSelectEl.value;
  topicSelectEl.textContent = "";
  themen.forEach(({ topic, count }) => {
    const option = document.createElement("option");
    option.value = topic;
    option.textContent = `${topic} (${count} Fragen)`;
    topicSelectEl.appendChild(option);
  });
  if (vorher && themen.some((t) => t.topic === vorher)) topicSelectEl.value = vorher;
  topicBtn.disabled = themen.length === 0;
}

// ---------------------------------------------------------------------
// Runde
// ---------------------------------------------------------------------

function showView(view) {
  startEl.hidden = view !== "start";
  roundEl.hidden = view !== "round";
  resultEl.hidden = view !== "result";
}

async function startRound({ size, topic = "" }) {
  setNote("");
  await refreshCurated();
  const pool = buildPool();
  renderTopics(pool);
  const fragen = pickQuestions(pool, size, { topic });
  if (fragen.length === 0) {
    setNote(
      topic
        ? `Zum Thema „${topic}" gibt es derzeit keine Fragen.`
        : "Es gibt derzeit keine Fragen. Sobald Produkte als geprüft markiert sind, füllt sich das Quiz automatisch."
    );
    showView("start");
    return;
  }
  runde = { fragen, index: 0, antworten: [], gewuenscht: size, topic };
  showView("round");
  renderQuestion();
}

function renderQuestion() {
  const frage = runde.fragen[runde.index];
  const richtige = runde.antworten.filter((a) => a.korrekt).length;

  progressTextEl.textContent = `Frage ${runde.index + 1} von ${runde.fragen.length}`;
  scoreTextEl.textContent = `${richtige} richtig`;
  progressFillEl.style.width = `${Math.round((runde.index / runde.fragen.length) * 100)}%`;

  questionTopicEl.textContent = frage.source === "kuratiert" ? `${frage.topic} · Hauswissen` : frage.topic;
  questionTextEl.textContent = frage.question;

  optionsEl.textContent = "";
  frage.options.forEach((option, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quiz-option";
    btn.textContent = option;
    btn.addEventListener("click", () => answer(i));
    optionsEl.appendChild(btn);
  });

  feedbackEl.hidden = true;
  jumpBtn.hidden = true;
}

function answer(gewaehlt) {
  const frage = runde.fragen[runde.index];
  if (runde.antworten.length > runde.index) return; // schon beantwortet
  const korrekt = gewaehlt === frage.correctIndex;
  runde.antworten.push({ frage, korrekt, gewaehlt });

  [...optionsEl.children].forEach((btn, i) => {
    btn.disabled = true;
    if (i === frage.correctIndex) btn.classList.add("is-correct");
    else if (i === gewaehlt) btn.classList.add("is-wrong");
  });

  feedbackTitleEl.textContent = korrekt ? "Richtig." : `Falsch – richtig ist: ${frage.options[frage.correctIndex]}`;
  feedbackTitleEl.className = korrekt ? "quiz-feedback-title is-correct" : "quiz-feedback-title is-wrong";
  feedbackExplanationEl.textContent = frage.explanation;
  feedbackExplanationEl.hidden = !frage.explanation;

  // Nach einer falschen Antwort direkt zum Eintrag springen können – da steht
  // der ganze Zusammenhang, nicht nur die eine Zeile Erklärung.
  const ziel = frage.refProduct ? "product" : frage.refRecipe ? "recipe" : "";
  if (!korrekt && ziel) {
    jumpBtn.hidden = false;
    jumpBtn.textContent = ziel === "product" ? `${frage.refProduct} ansehen` : `${frage.refRecipe} ansehen`;
    jumpBtn.dataset.kind = ziel;
    jumpBtn.dataset.name = ziel === "product" ? frage.refProduct : frage.refRecipe;
  } else {
    jumpBtn.hidden = true;
  }

  nextBtn.textContent = runde.index + 1 >= runde.fragen.length ? "Auswertung" : "Weiter";
  feedbackEl.hidden = false;
  recordAttempt(frage, korrekt);
}

// Versuch mitschreiben (Grundlage für die Auswertung in Paket 27). Schlägt
// das fehl (offline), läuft die Runde trotzdem weiter.
async function recordAttempt(frage, korrekt) {
  const nutzer = getCurrentUser();
  if (!nutzer) return;
  const supabase = getSupabaseClient();
  try {
    await supabase.from("quiz_attempts").insert({
      user_id: nutzer.id,
      question_key: frage.key,
      topic: frage.topic,
      correct: korrekt,
    });
  } catch {
    // Kein Netz – der Versuch geht verloren, die Runde nicht.
  }
}

function nextQuestion() {
  if (runde.index + 1 >= runde.fragen.length) {
    renderResult();
    return;
  }
  runde.index += 1;
  renderQuestion();
}

function renderResult() {
  const richtige = runde.antworten.filter((a) => a.korrekt).length;
  const gesamt = runde.antworten.length;
  const quote = gesamt > 0 ? Math.round((richtige / gesamt) * 100) : 0;

  resultTitleEl.textContent = `${richtige} von ${gesamt} richtig (${quote} %)`;
  resultSummaryEl.textContent =
    quote >= 80
      ? "Sitzt. Nächste Runde ruhig mit einem anderen Thema."
      : "Die falschen Fragen stehen unten – ein Klick führt direkt zum Eintrag.";

  resultListEl.textContent = "";
  const falsche = runde.antworten.filter((a) => !a.korrekt);
  if (falsche.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-note";
    p.textContent = "Keine Fehler in dieser Runde.";
    resultListEl.appendChild(p);
  }
  falsche.forEach(({ frage }) => {
    const item = document.createElement("div");
    item.className = "quiz-result-item";

    const frageEl = document.createElement("p");
    frageEl.className = "quiz-result-question";
    frageEl.textContent = frage.question;
    item.appendChild(frageEl);

    const antwortEl = document.createElement("p");
    antwortEl.className = "quiz-result-answer";
    antwortEl.textContent = `Richtig: ${frage.options[frage.correctIndex]}`;
    item.appendChild(antwortEl);

    if (frage.explanation) {
      const erklaerungEl = document.createElement("p");
      erklaerungEl.className = "quiz-result-explanation";
      erklaerungEl.textContent = frage.explanation;
      item.appendChild(erklaerungEl);
    }

    const ziel = frage.refProduct ? "product" : frage.refRecipe ? "recipe" : "";
    if (ziel) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "shortcut-chip";
      btn.textContent = ziel === "product" ? frage.refProduct : frage.refRecipe;
      btn.addEventListener("click", () => springeZu(ziel, ziel === "product" ? frage.refProduct : frage.refRecipe));
      item.appendChild(btn);
    }

    resultListEl.appendChild(item);
  });

  showView("result");
}

function springeZu(kind, name) {
  if (!name) return;
  if (kind === "product") {
    switchTab("products");
    focusProduct(name);
  } else {
    switchTab("recipes");
    focusRecipe(name);
  }
}

async function zurueckZumStart() {
  runde = null;
  await refreshCurated();
  renderTopics(buildPool());
  showView("start");
}

export function initQuiz() {
  quickBtn.addEventListener("click", () => startRound({ size: SCHNELLRUNDE }));
  examBtn.addEventListener("click", () => startRound({ size: PRUEFUNG }));
  topicBtn.addEventListener("click", () => startRound({ size: SCHNELLRUNDE, topic: topicSelectEl.value }));
  nextBtn.addEventListener("click", nextQuestion);
  againBtn.addEventListener("click", zurueckZumStart);
  abortBtn.addEventListener("click", zurueckZumStart);
  jumpBtn.addEventListener("click", () => springeZu(jumpBtn.dataset.kind, jumpBtn.dataset.name));

  // Themenliste aktuell halten, wenn Katalogänderungen hereinkommen – aber
  // nie in eine laufende Runde eingreifen.
  const aktualisiere = () => {
    if (!runde) renderTopics(buildPool());
  };
  onProductsChanged(aktualisiere);
  onRecipesChanged(aktualisiere);

  renderTopics(buildPool());
  showView("start");
  refreshCurated().then(() => {
    if (!runde) renderTopics(buildPool());
  });
}
