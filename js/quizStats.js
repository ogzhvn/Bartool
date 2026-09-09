// Rechenteil der Quiz-Auswertung (Paket 27).
//
// Bewusst ohne DOM- und Supabase-Zugriff: hier stecken nur Funktionen, die
// aus einer Liste von Versuchen Zahlen machen. Das hält js/quiz.js auf die
// Anzeige beschränkt und macht die Logik einzeln prüfbar.
//
// Ein Versuch hat die Form, in der er auch in quiz_attempts steht:
//   { question_key, topic, correct, answered_at, round_id }

// Höchstens die Hälfte einer Runde besteht aus Wiederholungsfragen – sonst
// dreht sich das Quiz nur noch um alte Fehler.
export const WIEDERHOLUNG_ANTEIL = 0.5;
// Unter so vielen Versuchen sagt eine Quote pro Thema nichts aus.
export const THEMA_MIN_VERSUCHE = 3;
export const VERLAUF_RUNDEN = 8;
export const SCHWACHE_THEMEN = 5;

export function quote(richtig, gesamt) {
  return gesamt > 0 ? Math.round((richtig / gesamt) * 100) : 0;
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Ohne round_id (Versuche aus der Zeit vor Paket 27) dient die angebrochene
// Stunde als Ersatzschlüssel – dieselbe Regel wie in quiz_team_overview().
function rundenSchluessel(versuch) {
  return versuch.round_id ?? `h:${String(versuch.answered_at ?? "").slice(0, 13)}`;
}

// question_key -> war der letzte Versuch richtig? Erwartet die Versuche
// absteigend nach answered_at; der erste Treffer ist damit der jüngste.
export function letzterStandProFrage(versuche) {
  const stand = new Map();
  versuche.forEach((v) => {
    if (!stand.has(v.question_key)) stand.set(v.question_key, v.correct === true);
  });
  return stand;
}

// Wiederholungslogik: zuletzt falsch beantwortete Fragen kommen bevorzugt
// wieder, aber nie mehr als die halbe Runde. Danach Fragen, die noch nie
// dran waren, dann die sitzenden, zum Schluss der Rest der alten Fehler.
export function waehleFragen(pool, anzahl, topic, stand) {
  const gefiltert = topic ? pool.filter((f) => f.topic === topic) : pool;

  const falsch = [];
  const neu = [];
  const sitzt = [];
  const gesehen = new Set();
  shuffle(gefiltert).forEach((frage) => {
    if (gesehen.has(frage.key)) return;
    gesehen.add(frage.key);
    if (!stand.has(frage.key)) neu.push(frage);
    else if (stand.get(frage.key)) sitzt.push(frage);
    else falsch.push(frage);
  });

  const auswahl = [];
  const nimm = (bucket, wieviele) => {
    while (bucket.length > 0 && auswahl.length < anzahl && wieviele > 0) {
      auswahl.push(bucket.shift());
      wieviele -= 1;
    }
  };

  nimm(falsch, Math.max(1, Math.ceil(anzahl * WIEDERHOLUNG_ANTEIL)));
  nimm(neu, anzahl - auswahl.length);
  nimm(sitzt, anzahl - auswahl.length);
  nimm(falsch, anzahl - auswahl.length);
  return auswahl;
}

// Rechnet die eigenen Versuche in die Zahlen um, die im Quiz-Tab stehen.
export function berechneStatistik(versuche) {
  const gesamt = versuche.length;
  const richtig = versuche.filter((v) => v.correct === true).length;

  const proThema = new Map();
  versuche.forEach((v) => {
    const thema = String(v.topic ?? "").trim();
    if (!thema) return;
    if (!proThema.has(thema)) proThema.set(thema, { topic: thema, versuche: 0, richtig: 0 });
    const eintrag = proThema.get(thema);
    eintrag.versuche += 1;
    if (v.correct === true) eintrag.richtig += 1;
  });
  const themen = [...proThema.values()]
    .map((t) => ({ ...t, quote: quote(t.richtig, t.versuche) }))
    .sort((a, b) => a.quote - b.quote || b.versuche - a.versuche || a.topic.localeCompare(b.topic, "de"));

  // Fürs Üben nur Themen mit belastbarer Grundlage; gibt es davon noch keine,
  // fällt die Schwelle weg, damit der Bereich nicht leer bleibt.
  let schwach = themen.filter((t) => t.versuche >= THEMA_MIN_VERSUCHE && t.quote < 100);
  if (schwach.length === 0) schwach = themen.filter((t) => t.quote < 100);
  schwach = schwach.slice(0, SCHWACHE_THEMEN);

  const proRunde = new Map();
  versuche.forEach((v) => {
    const schluessel = rundenSchluessel(v);
    if (!proRunde.has(schluessel)) {
      proRunde.set(schluessel, { schluessel, versuche: 0, richtig: 0, zuletzt: v.answered_at });
    }
    const eintrag = proRunde.get(schluessel);
    eintrag.versuche += 1;
    if (v.correct === true) eintrag.richtig += 1;
    if (String(v.answered_at) > String(eintrag.zuletzt)) eintrag.zuletzt = v.answered_at;
  });
  const runden = [...proRunde.values()]
    .sort((a, b) => String(b.zuletzt).localeCompare(String(a.zuletzt)))
    .slice(0, VERLAUF_RUNDEN)
    .map((r) => ({ ...r, quote: quote(r.richtig, r.versuche) }));

  return {
    gesamt,
    richtig,
    quote: quote(richtig, gesamt),
    themen,
    schwach,
    runden,
    rundenGesamt: proRunde.size,
  };
}
