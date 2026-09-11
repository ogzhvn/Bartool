import { getSupabaseClient } from "./supabaseClient.js";
import { getCurrentUser } from "./auth.js";
import { generateQuestions, listGeneratedTopics } from "./quizGenerator.js";
import { onProductsChanged, onRecipesChanged } from "./storage.js";
import {
  baueRangliste,
  berechneStatistik,
  letzterStandProFrage,
  waehleFragen,
  RANGLISTE_MIN_VERSUCHE,
  RANGLISTE_SORTIERUNGEN,
  RANGLISTE_ZEITRAEUME,
} from "./quizStats.js";
import { switchTab } from "./tabs.js";
import { focusProduct } from "./products.js";
import { focusRecipe } from "./recipes.js";
import { formatDate, formatDecimal, getLocale, onLanguageChanged, t } from "./i18n.js";

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

const statsEl = document.getElementById("quiz-stats");
const statsNoteEl = document.getElementById("quiz-stats-note");
const statsBodyEl = document.getElementById("quiz-stats-body");
const statsTilesEl = document.getElementById("quiz-stats-tiles");
const statsHistoryEl = document.getElementById("quiz-stats-history");
const statsWeakEl = document.getElementById("quiz-stats-weak");
const statsTopicsEl = document.getElementById("quiz-stats-topics");

const leaderboardEl = document.getElementById("quiz-leaderboard");

const resultEl = document.getElementById("quiz-result");
const resultTitleEl = document.getElementById("quiz-result-title");
const resultSummaryEl = document.getElementById("quiz-result-summary");
const resultListEl = document.getElementById("quiz-result-list");
const againBtn = document.getElementById("quiz-again");

// Kuratierte Fragen aus der DB, gecacht bis zum nächsten Rundenstart.
let curatedCache = [];
// Laufende Runde: { fragen, index, antworten: [{ frage, korrekt }] }
let runde = null;
// Eigene Versuche, neueste zuerst. Basis für Auswertung und Wiederholung.
let meineVersuche = [];
// Noch laufende Inserts – die Auswertung wartet darauf, bevor sie neu lädt.
let offeneInserts = [];
// Rangliste im Quiz-Tab, gebaut in initQuiz().
let rangliste = null;

// Wie viele eigene Versuche für die Auswertung geladen werden. Bei 25 Fragen
// pro Prüfungsrunde deckt das rund 160 Runden ab; alles darüber ist für die
// Trefferquote von heute ohnehin nicht mehr aussagekräftig.
const VERSUCHE_LIMIT = 4000;

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

// crypto.randomUUID() gibt es nur im secure context. Hinterm Tresen läuft das
// Tool auch mal über http im WLAN – dann greift der Fallback.
function neueRundenId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
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
    topic: txt(row.topic) || t("ui.servicewissen"),
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

// Für die Admin-Maske (js/adminQuiz.js): Rohzeilen inklusive inaktiver.
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
    topic: txt(question.topic) || t("ui.servicewissen"),
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
// Eigene Versuche: Auswertung (Paket 27) und Wiederholungslogik
// ---------------------------------------------------------------------

// Lädt die eigenen Versuche. Die RLS-Policy gibt ohnehin nur die eigenen
// Zeilen heraus; der Filter steht trotzdem da, damit die Absicht im Code
// sichtbar ist.
async function loadMyAttempts() {
  const nutzer = getCurrentUser();
  if (!nutzer) {
    meineVersuche = [];
    return null;
  }
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from("quiz_attempts")
      .select("question_key,topic,correct,answered_at,round_id")
      .eq("user_id", nutzer.id)
      .order("answered_at", { ascending: false })
      .limit(VERSUCHE_LIMIT);
    if (error) return error;
    meineVersuche = data ?? [];
    return null;
  } catch (err) {
    // Offline: die bisher lokal gesammelten Versuche bleiben stehen.
    return err;
  }
}

function kachel(wert, beschriftung) {
  const box = document.createElement("div");
  box.className = "quiz-stat-tile";
  const w = document.createElement("span");
  w.className = "quiz-stat-value";
  w.textContent = wert;
  const b = document.createElement("span");
  b.className = "quiz-stat-label";
  b.textContent = beschriftung;
  box.appendChild(w);
  box.appendChild(b);
  return box;
}

// Zeile mit Balken – dieselbe Optik für Themen und Rundenverlauf.
function quotenZeile({ label, meta, prozent, onClick }) {
  const zeile = document.createElement(onClick ? "button" : "div");
  zeile.className = onClick ? "quiz-quota-row is-clickable" : "quiz-quota-row";
  if (onClick) {
    zeile.type = "button";
    zeile.addEventListener("click", onClick);
  }

  const kopf = document.createElement("span");
  kopf.className = "quiz-quota-head";
  const name = document.createElement("span");
  name.className = "quiz-quota-label";
  name.textContent = label;
  const zahl = document.createElement("span");
  zahl.className = "quiz-quota-value";
  zahl.textContent = `${prozent} %`;
  kopf.appendChild(name);
  kopf.appendChild(zahl);
  zeile.appendChild(kopf);

  const balken = document.createElement("span");
  balken.className = "quiz-quota-bar";
  const fuellung = document.createElement("span");
  fuellung.className = prozent >= 80 ? "quiz-quota-fill is-good" : prozent >= 50 ? "quiz-quota-fill" : "quiz-quota-fill is-weak";
  fuellung.style.width = `${Math.max(2, prozent)}%`;
  balken.appendChild(fuellung);
  zeile.appendChild(balken);

  if (meta) {
    const metaEl = document.createElement("span");
    metaEl.className = "quiz-quota-meta";
    metaEl.textContent = meta;
    zeile.appendChild(metaEl);
  }
  return zeile;
}

function datumKurz(wert) {
  const d = new Date(wert);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(getLocale(), { day: "2-digit", month: "2-digit" });
}

function renderStats(fehler) {
  if (fehler) {
    statsNoteEl.hidden = false;
    statsNoteEl.textContent = t("ui.die_auswertung_konnte_nicht_geladen_werden_f2cb");
  } else {
    statsNoteEl.hidden = true;
    statsNoteEl.textContent = "";
  }

  const stat = berechneStatistik(meineVersuche);
  if (stat.gesamt === 0) {
    statsBodyEl.hidden = true;
    statsNoteEl.hidden = false;
    statsNoteEl.textContent = fehler
      ? statsNoteEl.textContent
      : t("ui.noch_keine_beantworteten_fragen_nach_der_99fb");
    return;
  }
  statsBodyEl.hidden = false;

  statsTilesEl.textContent = "";
  statsTilesEl.appendChild(kachel(`${stat.quote} %`, t("ui.trefferquote_gesamt")));
  statsTilesEl.appendChild(kachel(String(stat.rundenGesamt), stat.rundenGesamt === 1 ? t("ui.runde") : t("ui.runden")));
  statsTilesEl.appendChild(kachel(String(stat.gesamt), t("ui.fragen_beantwortet")));
  statsTilesEl.appendChild(kachel(String(stat.gesamt - stat.richtig), t("ui.davon_falsch")));

  statsHistoryEl.textContent = "";
  stat.runden.forEach((r, i) => {
    statsHistoryEl.appendChild(
      quotenZeile({
        label: i === 0 ? `${t("ui.letzte_runde")} ${datumKurz(r.zuletzt)}` : `${datumKurz(r.zuletzt)}`,
        meta: `${r.richtig} ${t("ui.von")} ${r.versuche} ${t("ui.richtig_klein")}`,
        prozent: r.quote,
      })
    );
  });

  statsWeakEl.textContent = "";
  if (stat.schwach.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-note";
    p.textContent = t("ui.kein_thema_unter_100_da_ist_gerade_nichts_0114");
    statsWeakEl.appendChild(p);
  }
  stat.schwach.forEach((thema) => {
    statsWeakEl.appendChild(
      quotenZeile({
        label: thema.topic,
        meta: `${thema.richtig} ${t("ui.von")} ${thema.versuche} ${t("ui.richtig_uebungsrunde_starten")}`,
        prozent: thema.quote,
        onClick: () => startRound({ size: SCHNELLRUNDE, topic: thema.topic }),
      })
    );
  });

  statsTopicsEl.textContent = "";
  [...stat.themen]
    .sort((a, b) => a.topic.localeCompare(b.topic, getLocale()))
    .forEach((thema) => {
      statsTopicsEl.appendChild(
        quotenZeile({
          label: thema.topic,
          meta: `${thema.richtig} ${t("ui.von")} ${thema.versuche} ${t("ui.richtig_klein")}`,
          prozent: thema.quote,
        })
      );
    });
}

async function refreshStats() {
  if (offeneInserts.length > 0) {
    const laufend = offeneInserts;
    offeneInserts = [];
    await Promise.allSettled(laufend);
  }
  const fehler = await loadMyAttempts();
  renderStats(fehler);
  // Eigene Versuche haben sich geändert – die Rangliste zieht mit.
  rangliste?.refresh();
}

// ---------------------------------------------------------------------
// Rangliste (Paket 41)
// ---------------------------------------------------------------------
//
// Die Rangliste steht im Quiz-Tab für jeden angemeldeten Nutzer – sie ist die
// erste Team-Auswertung ohne das Recht reports.view. Die RPC gibt deshalb nur
// Summen je Person heraus; einzelne Antworten bleiben privat. Ausgeblendete
// Personen (Sichtbarkeitsregel aus Paket 40) fehlen in der Liste, sehen sich
// selbst aber immer.
//
// createLeaderboard() baut die komplette Ansicht in einen beliebigen
// Container. Das Reporting benutzt dieselbe Funktion (js/adminReports.js),
// damit es die Liste nicht ein zweites Mal gibt.

const ZEITRAUM_LABEL = {
  gesamt: "ui.zeitraum_gesamt",
  "30tage": "ui.zeitraum_30_tage",
  monat: "ui.zeitraum_dieser_monat",
};

const SORTIER_LABEL = {
  correct: "ui.richtig_spalte",
  attempts: "ui.beantwortet_spalte",
  accuracy: "ui.quote",
};

export function createLeaderboard(container, { limit = 10 } = {}) {
  let zeitraum = RANGLISTE_ZEITRAEUME[0];
  let sortierung = "correct";
  let zeilen = [];
  let fehler = null;
  let laeuft = false;

  const wurzel = document.createElement("div");
  wurzel.className = "quiz-leaderboard";

  const chipsEl = document.createElement("div");
  chipsEl.className = "quiz-lb-chips";
  wurzel.appendChild(chipsEl);

  const noteEl = document.createElement("p");
  noteEl.className = "empty-note";
  noteEl.hidden = true;
  wurzel.appendChild(noteEl);

  const tabelleEl = document.createElement("table");
  tabelleEl.className = "quiz-lb-table";
  const kopfEl = document.createElement("thead");
  const koerperEl = document.createElement("tbody");
  tabelleEl.appendChild(kopfEl);
  tabelleEl.appendChild(koerperEl);
  wurzel.appendChild(tabelleEl);

  const hinweisEl = document.createElement("p");
  hinweisEl.className = "hint";
  wurzel.appendChild(hinweisEl);

  container.textContent = "";
  container.appendChild(wurzel);

  function renderChips() {
    chipsEl.textContent = "";
    RANGLISTE_ZEITRAEUME.forEach((wert) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = wert === zeitraum ? "quiz-lb-chip active" : "quiz-lb-chip";
      btn.textContent = t(ZEITRAUM_LABEL[wert]);
      btn.addEventListener("click", () => {
        if (wert === zeitraum) return;
        zeitraum = wert;
        refresh();
      });
      chipsEl.appendChild(btn);
    });
  }

  function kopfZelle(key, scope = "col") {
    const th = document.createElement("th");
    th.scope = scope;
    if (!RANGLISTE_SORTIERUNGEN.includes(key)) {
      th.textContent = t(SORTIER_LABEL[key] ?? key);
      return th;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = key === sortierung ? "quiz-lb-sort is-active" : "quiz-lb-sort";
    btn.textContent = t(SORTIER_LABEL[key]);
    btn.title = t("ui.nach_dieser_spalte_sortieren");
    btn.addEventListener("click", () => {
      if (key === sortierung) return;
      sortierung = key;
      render();
    });
    th.appendChild(btn);
    th.setAttribute("aria-sort", key === sortierung ? "descending" : "none");
    return th;
  }

  function renderKopf() {
    kopfEl.textContent = "";
    const zeile = document.createElement("tr");
    const platz = document.createElement("th");
    platz.scope = "col";
    platz.className = "quiz-lb-rank";
    platz.textContent = "#";
    platz.title = t("ui.platz");
    zeile.appendChild(platz);

    const name = document.createElement("th");
    name.scope = "col";
    name.textContent = t("ui.name");
    zeile.appendChild(name);

    zeile.appendChild(kopfZelle("attempts"));
    zeile.appendChild(kopfZelle("correct"));
    zeile.appendChild(kopfZelle("accuracy"));
    kopfEl.appendChild(zeile);
  }

  function zahlZelle(text, klasse) {
    const td = document.createElement("td");
    td.className = klasse ? `quiz-lb-num ${klasse}` : "quiz-lb-num";
    td.textContent = text;
    return td;
  }

  function datenZeile(eintrag) {
    const tr = document.createElement("tr");
    if (eintrag.istSelbst) tr.className = "is-self";

    const platz = document.createElement("td");
    platz.className = "quiz-lb-rank";
    platz.textContent = eintrag.rang === null ? "–" : formatDecimal(eintrag.rang, 0);
    tr.appendChild(platz);

    const name = document.createElement("td");
    name.className = "quiz-lb-name";
    // Name und Datum ausschließlich per textContent – der Anzeigename ist
    // eine Nutzereingabe.
    const nameText = document.createElement("span");
    nameText.textContent = eintrag.name || t("ui.unbekannt");
    name.appendChild(nameText);
    if (eintrag.istSelbst) {
      const du = document.createElement("span");
      du.className = "quiz-lb-self";
      du.textContent = t("ui.du");
      name.appendChild(du);
    }
    if (eintrag.zuletzt) {
      const meta = document.createElement("span");
      meta.className = "quiz-lb-meta";
      // Kurzes Datum ohne Jahr: in der schmalen Namensspalte ist kein Platz
      // für mehr, und für "wann zuletzt" reicht Tag und Monat.
      meta.textContent = `${t("ui.zuletzt")} ${formatDate(eintrag.zuletzt, { day: "2-digit", month: "2-digit" })}`;
      name.appendChild(meta);
    }
    tr.appendChild(name);

    tr.appendChild(zahlZelle(formatDecimal(eintrag.versuche, 0)));
    tr.appendChild(zahlZelle(formatDecimal(eintrag.richtig, 0)));
    tr.appendChild(
      zahlZelle(
        `${formatDecimal(eintrag.quote, 0)} %`,
        sortierung === "accuracy" && !eintrag.quotenfaehig ? "is-muted" : ""
      )
    );
    return tr;
  }

  function trennZeile() {
    const tr = document.createElement("tr");
    tr.className = "quiz-lb-gap";
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = "…";
    tr.appendChild(td);
    return tr;
  }

  function render() {
    renderChips();
    renderKopf();
    koerperEl.textContent = "";

    if (fehler) {
      noteEl.hidden = false;
      noteEl.textContent = t("ui.die_rangliste_konnte_nicht_geladen_werden");
      tabelleEl.hidden = true;
      hinweisEl.hidden = true;
      return;
    }

    const rangliste = baueRangliste(zeilen, sortierung);
    if (rangliste.length === 0) {
      noteEl.hidden = false;
      noteEl.textContent = laeuft ? t("ui.laedt") : t("ui.noch_hat_niemand_fragen_beantwortet_spiel");
      tabelleEl.hidden = true;
      hinweisEl.hidden = true;
      return;
    }

    noteEl.hidden = true;
    tabelleEl.hidden = false;
    hinweisEl.hidden = false;
    hinweisEl.textContent = t("ui.quotenplatz_erst_ab_versuchen", { anzahl: RANGLISTE_MIN_VERSUCHE });

    const oben = rangliste.slice(0, limit);
    oben.forEach((eintrag) => koerperEl.appendChild(datenZeile(eintrag)));

    // Die eigene Zeile ist immer zu sehen – liegt sie hinter den ersten
    // Plätzen, wird sie unten angehängt.
    const selbst = rangliste.find((eintrag) => eintrag.istSelbst);
    if (selbst && !oben.includes(selbst)) {
      koerperEl.appendChild(trennZeile());
      koerperEl.appendChild(datenZeile(selbst));
    }
  }

  async function refresh() {
    laeuft = true;
    render();
    const supabase = getSupabaseClient();
    try {
      const { data, error } = await supabase.rpc("quiz_leaderboard", { p_zeitraum: zeitraum });
      if (error) throw error;
      zeilen = data ?? [];
      fehler = null;
    } catch (err) {
      zeilen = [];
      fehler = err;
    }
    laeuft = false;
    render();
  }

  onLanguageChanged(render);
  render();
  return { refresh, render };
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
    option.textContent = `${topic} (${count} ${t("ui.fragen")}`;
    topicSelectEl.appendChild(option);
  });
  if (vorher && themen.some((thema) => thema.topic === vorher)) topicSelectEl.value = vorher;
  topicBtn.disabled = themen.length === 0;
}

// ---------------------------------------------------------------------
// Runde
// ---------------------------------------------------------------------

function showView(view) {
  startEl.hidden = view !== "start";
  roundEl.hidden = view !== "round";
  resultEl.hidden = view !== "result";
  // Die eigene Auswertung steht unter der Modusauswahl und hat in einer
  // laufenden Runde nichts zu suchen.
  statsEl.hidden = view !== "start";
}

async function startRound({ size, topic = "" }) {
  setNote("");
  await refreshCurated();
  const pool = buildPool();
  renderTopics(pool);
  const fragen = waehleFragen(pool, size, topic, letzterStandProFrage(meineVersuche));
  if (fragen.length === 0) {
    setNote(
      topic
        ? `${t("ui.zum_thema")}${topic}${t("ui.gibt_es_derzeit_keine_fragen")}`
        : t("ui.es_gibt_derzeit_keine_fragen_sobald_08fe")
    );
    showView("start");
    return;
  }
  runde = { fragen, index: 0, antworten: [], gewuenscht: size, topic, id: neueRundenId() };
  showView("round");
  renderQuestion();
}

function renderQuestion() {
  const frage = runde.fragen[runde.index];
  const richtige = runde.antworten.filter((a) => a.korrekt).length;

  progressTextEl.textContent = `${t("ui.frage")} ${runde.index + 1} ${t("ui.von")} ${runde.fragen.length}`;
  scoreTextEl.textContent = t("ui.punktestand_richtig", { n: richtige });
  progressFillEl.style.width = `${Math.round((runde.index / runde.fragen.length) * 100)}%`;

  questionTopicEl.textContent = frage.source === "kuratiert" ? `${frage.topic} ${t("ui.hauswissen")}` : frage.topic;
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

  feedbackTitleEl.textContent = korrekt ? t("ui.richtig_d1bb") : `${t("ui.falsch_richtig_ist")} ${frage.options[frage.correctIndex]}`;
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

  nextBtn.textContent = runde.index + 1 >= runde.fragen.length ? t("ui.auswertung") : t("ui.weiter");
  feedbackEl.hidden = false;
  recordAttempt(frage, korrekt);
}

// Versuch mitschreiben (Grundlage für die Auswertung in Paket 27). Schlägt
// das fehl (offline), läuft die Runde trotzdem weiter.
function recordAttempt(frage, korrekt) {
  const nutzer = getCurrentUser();
  if (!nutzer) return;

  // Sofort lokal mitschreiben: so stimmen Auswertung und Wiederholungslogik
  // auch dann, wenn der Insert unterwegs hängen bleibt.
  meineVersuche.unshift({
    question_key: frage.key,
    topic: frage.topic,
    correct: korrekt,
    answered_at: new Date().toISOString(),
    round_id: runde?.id ?? null,
  });

  const supabase = getSupabaseClient();
  const insert = (async () => {
    try {
      await supabase.from("quiz_attempts").insert({
        user_id: nutzer.id,
        question_key: frage.key,
        topic: frage.topic,
        correct: korrekt,
        round_id: runde?.id ?? null,
      });
    } catch {
      // Kein Netz – der Versuch steht nur lokal, die Runde läuft weiter.
    }
  })();
  offeneInserts.push(insert);
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

  resultTitleEl.textContent = `${richtige} ${t("ui.von")} ${gesamt} ${t("ui.richtig_klein")} (${quote} %)`;
  resultSummaryEl.textContent =
    quote >= 80
      ? t("ui.sitzt_naechste_runde_ruhig_mit_einem_de2f")
      : t("ui.die_falschen_fragen_stehen_unten_ein_klick_475e");

  resultListEl.textContent = "";
  const falsche = runde.antworten.filter((a) => !a.korrekt);
  if (falsche.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-note";
    p.textContent = t("ui.keine_fehler_in_dieser_runde");
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
    antwortEl.textContent = `${t("ui.richtig")} ${frage.options[frage.correctIndex]}`;
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
  showView("start");
  renderStats(null);
  await refreshCurated();
  renderTopics(buildPool());
  await refreshStats();
}

export function initQuiz() {
  if (leaderboardEl) rangliste = createLeaderboard(leaderboardEl);

  // Sprachwechsel: neu rendern, damit kein Neuladen nötig ist.
  onLanguageChanged(() => {
    renderTopics(buildPool());
    refreshStats();
  });

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
  refreshStats();
  refreshCurated().then(() => {
    if (!runde) renderTopics(buildPool());
  });
}
