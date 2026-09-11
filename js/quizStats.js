import { getLocale, t } from "./i18n.js";
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

// Höchstzahl Fragen aus einem Thema in einer gemischten Runde. Der Fragenpool
// ist sehr ungleich verteilt – allein Wein stellt ein Mehrfaches der übrigen
// Gruppen –, ohne Grenze wäre eine Schnellrunde fast nur Wein.
export function maxProThema(anzahl) {
  return Math.max(2, Math.ceil(anzahl / 4));
}

// Wiederholungslogik: zuletzt falsch beantwortete Fragen kommen bevorzugt
// wieder, aber nie mehr als die halbe Runde. Danach Fragen, die noch nie
// dran waren, dann die sitzenden, zum Schluss der Rest der alten Fehler.
//
// Quer dazu liegt die Themengrenze: in einer gemischten Runde stellt kein
// Thema mehr als `grenze` Fragen. Reicht die Runde damit nicht voll (kleiner
// Pool, wenige Themen), wird die Grenze am Ende aufgehoben – eine kurze Runde
// ist schlechter als eine einseitige. In einer Themenrunde gilt sie nie.
export function waehleFragen(pool, anzahl, topic, stand, grenze) {
  const gefiltert = topic ? pool.filter((f) => f.topic === topic) : pool;
  const obergrenze = topic ? Infinity : (grenze ?? maxProThema(anzahl));

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
  const proThema = new Map();
  // Wegen der Themengrenze übersprungene Fragen – Reserve für den Fall, dass
  // die Runde sonst zu kurz bleibt.
  const reserve = [];
  const nimm = (bucket, wieviele, achteAufThema = true) => {
    while (bucket.length > 0 && auswahl.length < anzahl && wieviele > 0) {
      const frage = bucket.shift();
      const thema = String(frage.topic ?? "");
      if (achteAufThema && (proThema.get(thema) ?? 0) >= obergrenze) {
        reserve.push(frage);
        continue;
      }
      proThema.set(thema, (proThema.get(thema) ?? 0) + 1);
      auswahl.push(frage);
      wieviele -= 1;
    }
  };

  nimm(falsch, Math.max(1, Math.ceil(anzahl * WIEDERHOLUNG_ANTEIL)));
  nimm(neu, anzahl - auswahl.length);
  nimm(sitzt, anzahl - auswahl.length);
  nimm(falsch, anzahl - auswahl.length);
  // Zum Schluss ohne Themengrenze: erst die zurückgestellten Fragen, dann der
  // noch nicht angefasste Rest der Körbe.
  nimm(reserve, anzahl - auswahl.length, false);
  [neu, sitzt, falsch].forEach((bucket) => nimm(bucket, anzahl - auswahl.length, false));
  return auswahl;
}

// Ab so vielen Themen wird die Auswahlliste im Quiz nach Oberkategorie
// gruppiert – darunter ist eine flache Liste übersichtlicher.
export const TOPIC_GRUPPIERUNG_AB = 12;

// Bringt die Themenliste aus listGeneratedTopics() in Gruppen für das
// Auswahlfeld. Oberkategorien mit mehr als einem Thema (heute Wein mit Rot-,
// Weiß- und Roséwein) bekommen eine eigene Überschrift, alles andere landet
// gesammelt unter Produkte bzw. Rezepte – eine Überschrift über einem einzigen
// Eintrag desselben Namens hilft hinterm Tresen nicht.
export function themenGruppen(themen) {
  const proParent = new Map();
  themen.forEach((thema) => {
    const parent = thema.parent || thema.topic;
    if (!proParent.has(parent)) proParent.set(parent, []);
    proParent.get(parent).push(thema);
  });

  const nachName = (a, b) => a.topic.localeCompare(b.topic, getLocale());
  const rezepte = t("ui.rezepte");
  const eigene = [];
  const sammelProdukte = [];
  const sammelRezepte = [];
  proParent.forEach((liste, parent) => {
    if (parent === rezepte) sammelRezepte.push(...liste);
    else if (liste.length > 1) eigene.push({ label: parent, themen: liste.sort(nachName) });
    else sammelProdukte.push(...liste);
  });

  const gruppen = [];
  if (sammelProdukte.length > 0) {
    gruppen.push({ label: t("ui.produkte"), themen: sammelProdukte.sort(nachName) });
  }
  gruppen.push(...eigene.sort((a, b) => a.label.localeCompare(b.label, getLocale())));
  if (sammelRezepte.length > 0) gruppen.push({ label: rezepte, themen: sammelRezepte.sort(nachName) });
  return gruppen;
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
    .map((thema) => ({ ...thema, quote: quote(thema.richtig, thema.versuche) }))
    .sort((a, b) => a.quote - b.quote || b.versuche - a.versuche || a.topic.localeCompare(b.topic, getLocale()));

  // Fürs Üben nur Themen mit belastbarer Grundlage; gibt es davon noch keine,
  // fällt die Schwelle weg, damit der Bereich nicht leer bleibt.
  let schwach = themen.filter((thema) => thema.versuche >= THEMA_MIN_VERSUCHE && thema.quote < 100);
  if (schwach.length === 0) schwach = themen.filter((thema) => thema.quote < 100);
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

// ── Rangliste (Paket 41) ─────────────────────────────────────────────────
//
// Rechenteil der Team-Rangliste: aus den Summen je Person, die
// quiz_leaderboard() liefert, werden Reihenfolge und Plätze. Die Anzeige
// steckt in js/quiz.js, damit diese Regeln einzeln prüfbar bleiben.

// Zeiträume, die die RPC kennt. Erster Eintrag ist die Vorgabe.
export const RANGLISTE_ZEITRAEUME = ["gesamt", "30tage", "monat"];
// Sortierschlüssel der Rangliste. Vorgabe ist "correct" (richtig beantwortet).
export const RANGLISTE_SORTIERUNGEN = ["correct", "attempts", "accuracy"];
// Unter so vielen Versuchen im Zeitraum gibt es keinen Quotenplatz – sonst
// gewinnt, wer drei Fragen richtig hatte. In den absoluten Zahlen läuft die
// Person trotzdem mit.
export const RANGLISTE_MIN_VERSUCHE = 20;

function ranglisteWert(eintrag, sortierung) {
  if (sortierung === "attempts") return eintrag.versuche;
  if (sortierung === "accuracy") return eintrag.quote;
  return eintrag.richtig;
}

// Wandelt eine Zeile aus quiz_leaderboard() in die Form, mit der die Anzeige
// arbeitet. Zahlen kommen als numeric zurück und damit je nach Treiber auch
// mal als Text – deshalb durchgehend Number().
function ranglisteEintrag(zeile) {
  const versuche = Number(zeile?.attempts ?? 0);
  const richtig = Number(zeile?.correct ?? 0);
  const gemeldeteQuote = Number(zeile?.accuracy);
  return {
    userId: String(zeile?.user_id ?? ""),
    // Anzeigename oder Benutzername; die RPC gibt nie eine E-Mail heraus.
    name: String(zeile?.display_name ?? "").trim(),
    versuche,
    richtig,
    quote: Number.isFinite(gemeldeteQuote) ? gemeldeteQuote : quote(richtig, versuche),
    runden: Number(zeile?.rounds ?? 0),
    zuletzt: zeile?.last_answered_at ?? null,
    istSelbst: zeile?.ist_selbst === true,
    quotenfaehig: versuche >= RANGLISTE_MIN_VERSUCHE,
  };
}

// Reihenfolge und Platzvergabe. Gleichstände teilen sich den Platz, danach
// entsteht eine Lücke (1, 2, 2, 4). Bei der Quote bekommen Personen unter der
// Mindestzahl an Versuchen keinen Platz (rang === null) und stehen am Ende.
export function baueRangliste(zeilen, sortierung = "correct") {
  const art = RANGLISTE_SORTIERUNGEN.includes(sortierung) ? sortierung : "correct";
  const eintraege = (Array.isArray(zeilen) ? zeilen : []).map(ranglisteEintrag);

  const gereiht = eintraege.sort((a, b) => {
    if (art === "accuracy" && a.quotenfaehig !== b.quotenfaehig) return a.quotenfaehig ? -1 : 1;
    return (
      ranglisteWert(b, art) - ranglisteWert(a, art) ||
      b.versuche - a.versuche ||
      a.name.localeCompare(b.name, getLocale())
    );
  });

  let letzterWert = null;
  let letzterRang = 0;
  let gezaehlt = 0;
  return gereiht.map((eintrag) => {
    if (art === "accuracy" && !eintrag.quotenfaehig) return { ...eintrag, rang: null };
    gezaehlt += 1;
    const wert = ranglisteWert(eintrag, art);
    if (letzterWert === null || wert !== letzterWert) {
      letzterRang = gezaehlt;
      letzterWert = wert;
    }
    return { ...eintrag, rang: letzterRang };
  });
}
