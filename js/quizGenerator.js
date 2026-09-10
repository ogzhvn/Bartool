import { getAllProducts } from "./productLibrary.js";
import { getAllRecipes } from "./recipeLibrary.js";
import { formatNumberLocal } from "./utils.js";
import { getLocale, t } from "./i18n.js";

// Fragen-Generator für das Quiz (Paket 26).
//
// Grundsatz: kein zweiter Datenbestand. Alles, was hier gefragt wird, steht
// bereits im Katalog – gelesen ausschließlich über getAllProducts() /
// getAllRecipes(), nie aus den Datendateien.
//
// Zwei harte Regeln bestimmen den ganzen Aufbau:
//   1. Nur Produkte mit verified === true liefern Faktenfragen. Ungeprüfte
//      Angaben darf niemand auswendig lernen.
//   2. Ablenker kommen immer aus derselben Produktgruppe bzw. Rezept-
//      kategorie. Sonst ist jede Frage durch Ausschluss lösbar ("nur eine
//      Antwort ist überhaupt ein Land"). Finden sich weniger als drei
//      brauchbare Ablenker, wird die Frage übersprungen statt schlecht
//      gestellt.
//
// Der question_key ist über Sessions hinweg stabil ("gen:abv:<Produktname>"),
// damit Wiederholung und Schwächenanalyse (Paket 27) daran andocken können.

const MIN_ABLENKER = 3;
// Antwortoptionen müssen in eine Zeile passen. Die Weintexte aus Paket 25
// sind teils ganze Sätze (Ausbau, Food-Pairing, Süße mit Klammerhinweis);
// als Antwortmöglichkeit taugen sie dann nicht. Wer länger ist, fliegt raus –
// die Frage entsteht dann nur für die Produkte, deren Wert kurz genug ist.
const MAX_ANTWORT_LAENGE = 60;

function txt(value) {
  return String(value ?? "").trim();
}

function normKey(value) {
  return txt(value).toLowerCase();
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Baut aus richtiger Antwort + Kandidaten eine fertige Frage. Gibt null
// zurück, wenn zu wenige unterschiedliche Ablenker übrig bleiben – so kann
// jeder Fragetyp einfach `.filter(Boolean)` anhängen.
function baueFrage({ key, question, correct, candidates, explanation, topic, topicGroup, difficulty, refProduct, refRecipe }) {
  const richtig = txt(correct);
  if (!richtig) return null;

  const gesehen = new Set([normKey(richtig)]);
  const ablenker = [];
  shuffle(candidates).forEach((kandidat) => {
    const wert = txt(kandidat);
    if (!wert || gesehen.has(normKey(wert))) return;
    gesehen.add(normKey(wert));
    if (ablenker.length < MIN_ABLENKER) ablenker.push(wert);
  });
  if (ablenker.length < MIN_ABLENKER) return null;

  const options = shuffle([richtig, ...ablenker]);
  return {
    key,
    question,
    options,
    correctIndex: options.indexOf(richtig),
    explanation: txt(explanation),
    topic,
    // Oberkategorie des Themas – nur für die Gruppierung der Themenliste.
    // Bei Produkten mit Untergruppe ist das die Gruppe (Rotwein → Wein).
    topicGroup: txt(topicGroup) || topic,
    difficulty: difficulty ?? 2,
    refProduct: refProduct ?? "",
    refRecipe: refRecipe ?? "",
    source: "generator",
  };
}

function gruppiereNach(items, schluesselFn) {
  const map = new Map();
  items.forEach((item) => {
    const schluessel = txt(schluesselFn(item));
    if (!schluessel) return;
    if (!map.has(schluessel)) map.set(schluessel, []);
    map.get(schluessel).push(item);
  });
  return map;
}

function gruppiere(items, feld) {
  const map = new Map();
  items.forEach((item) => {
    const schluessel = txt(item[feld]);
    if (!schluessel) return;
    if (!map.has(schluessel)) map.set(schluessel, []);
    map.get(schluessel).push(item);
  });
  return map;
}

// ---------------------------------------------------------------------
// Produktfragen
// ---------------------------------------------------------------------

// Nur geprüfte Produkte mit Gruppenzuordnung: ohne Gruppe gibt es keine
// saubere Ablenkerauswahl.
function gepruefteProdukte() {
  return getAllProducts().filter((p) => p?.verified === true && txt(p.group));
}

// Ab so vielen geprüften Produkten wird eine Gruppe im Quiz überhaupt nach
// Untergruppe aufgeteilt – darunter ist ein Sammelthema kein Problem.
const GRUPPE_SPLIT_AB = 20;
// So viele Produkte braucht eine Untergruppe mindestens, um als eigenes Thema
// zu taugen: die richtige Antwort plus drei Ablenker.
const MIN_EINHEIT = 1 + MIN_ABLENKER;

// Welche Gruppen werden geteilt? Nur die, bei denen der Schnitt aufgeht:
// die Gruppe ist groß, jedes Produkt darin hat eine Untergruppe und jede
// Untergruppe hat genug Produkte für eigene Ablenker. Bei Wein (76 Produkte,
// Rotwein/Weißwein/Roséwein) ist das der Fall – ohne den Schnitt stünde dort
// ein Thema mit mehreren hundert Fragen und ein Rotwein träte gegen einen
// Rosé an. Whisky, Gin, Rum und Liköre bleiben ungeteilt: dort blieben pro
// Untergruppe ein bis vier Produkte übrig, zu wenig für saubere Ablenker.
function geteilteGruppen(produkte) {
  const proGruppe = gruppiere(produkte, "group");
  const geteilt = new Set();
  proGruppe.forEach((liste, gruppe) => {
    if (liste.length < GRUPPE_SPLIT_AB) return;
    if (liste.some((p) => !txt(p.subGroup))) return;
    const einheiten = gruppiere(liste, "subGroup");
    let tragfaehig = einheiten.size > 1;
    einheiten.forEach((einheit) => {
      if (einheit.length < MIN_EINHEIT) tragfaehig = false;
    });
    if (tragfaehig) geteilt.add(gruppe);
  });
  return geteilt;
}

// Themen-Einheit eines Produkts: die Untergruppe, wenn die Gruppe geteilt
// wird, sonst die Gruppe. Ablenker kommen immer aus derselben Einheit.
export function quizThema(product, geteilt) {
  const gruppe = txt(product?.group);
  const unter = txt(product?.subGroup);
  const teilung = geteilt ?? geteilteGruppen(gepruefteProdukte());
  return unter && teilung.has(gruppe) ? unter : gruppe;
}

// Kurz genug für eine Antwortzeile?
function passtInEineZeile(wert) {
  const text = txt(wert);
  return text.length > 0 && text.length <= MAX_ANTWORT_LAENGE;
}

function formatAbv(value) {
  const zahl = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(zahl) || zahl <= 0) return "";
  return `${formatNumberLocal(zahl)} % vol`;
}

// Erklärung nach der Antwort: der Fakt selbst, ergänzt um den Quick Pitch,
// wenn einer gepflegt ist.
function mitPitch(product, satz) {
  const pitch = txt(product.quickPitch);
  return pitch ? `${satz} ${pitch}` : satz;
}

// Gemeinsames Gerüst für alle Fragen "ein Feld eines Produkts erraten".
function feldFragen({ produkte, thema: themaVon, feld, keyPrefix, frage, erklaerung, formatiere, difficulty, nurKurz = false, zusatzFilter }) {
  const nachThema = gruppiereNach(produkte, themaVon);
  const fragen = [];
  produkte.forEach((product) => {
    const wert = (p) => {
      const roh = formatiere ? formatiere(p[feld]) : txt(p[feld]);
      return nurKurz && !passtInEineZeile(roh) ? "" : roh;
    };
    const richtig = wert(product);
    if (!richtig) return;
    const thema = themaVon(product);
    const einheit = nachThema.get(thema) ?? [];
    if (zusatzFilter && !zusatzFilter(product, einheit)) return;
    const kandidaten = einheit
      .filter((p) => p.name !== product.name)
      .map(wert);
    const frageObjekt = baueFrage({
      key: `gen:${keyPrefix}:${product.name}`,
      question: frage(product),
      correct: richtig,
      candidates: kandidaten,
      explanation: erklaerung(product, richtig),
      topic: thema,
      topicGroup: txt(product.group),
      difficulty,
      refProduct: product.name,
    });
    if (frageObjekt) fragen.push(frageObjekt);
  });
  return fragen;
}

// 1. Alkoholgehalt
function abvFragen(produkte, themaVon) {
  return feldFragen({
    produkte,
    thema: themaVon,
    feld: "abvValue",
    keyPrefix: "abv",
    frage: (p) => t("ui.quiz_frage_abv", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_abv", { name: p.name, wert })),
    formatiere: formatAbv,
    difficulty: 2,
  });
}

// 2. Herkunftsland
function herkunftFragen(produkte, themaVon) {
  return feldFragen({
    produkte,
    thema: themaVon,
    feld: "originCountry",
    keyPrefix: "country",
    frage: (p) => t("ui.quiz_frage_land", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_land", { name: p.name, wert })),
    difficulty: 1,
  });
}

// 3. Rohstoff
function rohstoffFragen(produkte, themaVon) {
  return feldFragen({
    produkte,
    thema: themaVon,
    feld: "baseMaterial",
    keyPrefix: "base",
    frage: (p) => t("ui.quiz_frage_grundstoff", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_grundstoff", { name: p.name, wert })),
    difficulty: 2,
  });
}

// 7. Herstellungsverfahren
function verfahrenFragen(produkte, themaVon) {
  return feldFragen({
    produkte,
    thema: themaVon,
    feld: "productionMethod",
    keyPrefix: "production",
    frage: (p) => t("ui.quiz_frage_verfahren", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_verfahren", { name: p.name, wert })),
    difficulty: 3,
  });
}

// ---------------------------------------------------------------------
// Wein- und Schaumweinfragen (Paket 39)
//
// Alle über dasselbe feldFragen()-Gerüst, mit zwei Zusätzen: `nurKurz`
// wirft Werte raus, die als Antwortzeile zu lang sind (die Pflegetexte aus
// Paket 25 sind teils ganze Sätze), und die Themen-Einheit ist die
// Untergruppe – ein Rotwein bekommt damit nur Rotweine als Ablenker.
// ---------------------------------------------------------------------

const WEIN_FELDER = [
  { feld: "grapeVariety", keyPrefix: "grape", frage: "ui.quiz_frage_rebsorte", erklaerung: "ui.quiz_erklaerung_rebsorte", difficulty: 3 },
  { feld: "region", keyPrefix: "region", frage: "ui.quiz_frage_region", erklaerung: "ui.quiz_erklaerung_region", difficulty: 2 },
  { feld: "producer", keyPrefix: "producer", frage: "ui.quiz_frage_erzeuger", erklaerung: "ui.quiz_erklaerung_erzeuger", difficulty: 3 },
  { feld: "sweetness", keyPrefix: "sweet", frage: "ui.quiz_frage_suesse", erklaerung: "ui.quiz_erklaerung_suesse", difficulty: 1 },
  { feld: "aging", keyPrefix: "aging", frage: "ui.quiz_frage_ausbau", erklaerung: "ui.quiz_erklaerung_ausbau", difficulty: 3 },
  { feld: "servingTemp", keyPrefix: "temp", frage: "ui.quiz_frage_serviertemperatur", erklaerung: "ui.quiz_erklaerung_serviertemperatur", difficulty: 2 },
  { feld: "classification", keyPrefix: "class", frage: "ui.quiz_frage_klassifikation", erklaerung: "ui.quiz_erklaerung_klassifikation", difficulty: 3 },
  { feld: "body", keyPrefix: "body", frage: "ui.quiz_frage_koerper", erklaerung: "ui.quiz_erklaerung_koerper", difficulty: 2 },
];

// Food-Pairing bleibt in diesem Paket bewusst draußen: die Texte sind
// durchgängig ganze Sätze und taugen nicht als Antwortoption.

function weinFeldFragen(produkte, themaVon) {
  return WEIN_FELDER.flatMap(({ feld, keyPrefix, frage, erklaerung, difficulty }) =>
    feldFragen({
      produkte,
      thema: themaVon,
      feld,
      keyPrefix,
      frage: (p) => t(frage, { name: p.name }),
      erklaerung: (p, wert) => mitPitch(p, t(erklaerung, { name: p.name, wert })),
      difficulty,
      nurKurz: true,
    })
  );
}

// Jahrgang nur mit Bremse: `vintage` ist ein Textfeld und enthält teils
// Hinweise statt einer Jahreszahl ("Aktueller Jahrgang – bitte laut Etikett
// eintragen"). Gefragt wird nur, wo eine echte vierstellige Jahreszahl steht
// und die Themen-Einheit mindestens vier verschiedene davon kennt – sonst
// wären die Ablenker Nachbarjahre und die Frage rät sich von selbst.
const MIN_JAHRGAENGE = 4;

function jahrgang(value) {
  const text = txt(value);
  return /^[0-9]{4}$/.test(text) ? text : "";
}

function jahrgangFragen(produkte, themaVon) {
  return feldFragen({
    produkte,
    thema: themaVon,
    feld: "vintage",
    keyPrefix: "vintage",
    frage: (p) => t("ui.quiz_frage_jahrgang", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_jahrgang", { name: p.name, wert })),
    formatiere: jahrgang,
    difficulty: 3,
    zusatzFilter: (_product, einheit) =>
      new Set(einheit.map((p) => jahrgang(p.vintage)).filter(Boolean)).size >= MIN_JAHRGAENGE,
  });
}

// 4. Tasting Notes → welches Produkt passt
//
// Umgekehrte Richtung: die Aromen sind die Frage, gesucht ist das Produkt.
// Ablenker sind Produkte derselben Gruppe, deren Aromen sich nicht mit den
// genannten überschneiden – sonst gäbe es zwei richtige Antworten.
function aromaFragen(produkte, themaVon) {
  const nachThema = gruppiereNach(produkte, themaVon);
  const fragen = [];
  produkte.forEach((product) => {
    const tags = (Array.isArray(product.flavorTags) ? product.flavorTags : [])
      .map((wert) => txt(wert))
      .filter(Boolean);
    if (tags.length < 2) return;
    const eigene = new Set(tags.map(normKey));
    const kandidaten = (nachThema.get(themaVon(product)) ?? [])
      .filter((p) => p.name !== product.name)
      .filter((p) => {
        const fremde = Array.isArray(p.flavorTags) ? p.flavorTags : [];
        return !fremde.some((wert) => eigene.has(normKey(wert)));
      })
      .map((p) => p.name);
    const frage = baueFrage({
      key: `gen:notes:${product.name}`,
      question: t("ui.quiz_frage_aroma", { gruppe: themaVon(product), tags: tags.join(", ") }),
      correct: product.name,
      candidates: kandidaten,
      explanation: mitPitch(product, `${product.name}: ${tags.join(", ")}.`),
      topic: themaVon(product),
      topicGroup: txt(product.group),
      difficulty: 3,
      refProduct: product.name,
    });
    if (frage) fragen.push(frage);
  });
  return fragen;
}

// ---------------------------------------------------------------------
// Rezeptfragen
// ---------------------------------------------------------------------

function rezepteMitKategorie() {
  return getAllRecipes().filter((r) => txt(r?.name) && txt(r?.category));
}

// Zubereitungsart aus dem Methodentext ableiten. Bewusst nur die vier
// Techniken, die im Rezeptbuch tatsächlich vorkommen, und in dieser
// Reihenfolge: ein Sour, der mit Soda aufgefüllt wird, bleibt geschüttelt.
// Passt kein Stichwort, entsteht keine Frage.
export function methodenTechnik(methodText) {
  const text = txt(methodText).toLowerCase();
  if (!text) return "";
  if (text.includes("blender") || text.includes("mixer")) return t("ui.im_blender");
  if (text.includes("schüttel") || text.includes("shak")) return t("ui.geschuettelt");
  if (text.includes("rühr")) return t("ui.geruehrt");
  if (text.includes("im glas") || text.includes("aufgießen") || text.includes("auffüllen")) return t("ui.direkt_im_glas_gebaut");
  return "";
}

// Gemeinsames Gerüst für "ein Feld eines Rezepts erraten" (Glas, Garnitur).
function rezeptFeldFragen({ rezepte, feld, keyPrefix, frage, erklaerung, difficulty }) {
  const nachKategorie = gruppiere(rezepte, "category");
  const fragen = [];
  rezepte.forEach((recipe) => {
    const richtig = txt(recipe[feld]);
    if (!richtig) return;
    const kandidaten = (nachKategorie.get(txt(recipe.category)) ?? [])
      .filter((r) => r.name !== recipe.name)
      .map((r) => txt(r[feld]));
    const frageObjekt = baueFrage({
      key: `gen:${keyPrefix}:${recipe.name}`,
      question: frage(recipe),
      correct: richtig,
      candidates: kandidaten,
      explanation: erklaerung(recipe, richtig),
      topic: txt(recipe.category),
      difficulty,
      refRecipe: recipe.name,
    });
    if (frageObjekt) fragen.push(frageObjekt);
  });
  return fragen;
}

// 5. Rezept → Zutat
//
// Gefragt wird eine Zutat des Drinks, die Ablenker sind Zutaten anderer
// Drinks derselben Kategorie, die in diesem Rezept nicht vorkommen.
function zutatenFragen(rezepte) {
  const nachKategorie = gruppiere(rezepte, "category");
  const fragen = [];
  rezepte.forEach((recipe) => {
    const zutaten = (recipe.ingredients ?? []).map((i) => txt(i?.name)).filter(Boolean);
    if (zutaten.length === 0) return;
    const eigene = new Set(zutaten.map(normKey));
    // Immer dieselbe Zutat pro Rezept fragen (die erste, meist die Basis-
    // spirituose), damit der question_key eine feste Bedeutung behält.
    const richtig = zutaten[0];
    const kandidaten = [];
    (nachKategorie.get(txt(recipe.category)) ?? [])
      .filter((r) => r.name !== recipe.name)
      .forEach((r) => {
        (r.ingredients ?? []).forEach((i) => {
          const name = txt(i?.name);
          if (name && !eigene.has(normKey(name))) kandidaten.push(name);
        });
      });
    const frage = baueFrage({
      key: `gen:ingredient:${recipe.name}`,
      question: t("ui.quiz_frage_zutaten", { name: recipe.name }),
      correct: richtig,
      candidates: kandidaten,
      explanation: `${recipe.name}: ${zutaten.join(", ")}.`,
      topic: txt(recipe.category),
      difficulty: 1,
      refRecipe: recipe.name,
    });
    if (frage) fragen.push(frage);
  });
  return fragen;
}

// 6a. Rezept → Glas
function glasFragen(rezepte) {
  return rezeptFeldFragen({
    rezepte,
    feld: "glass",
    keyPrefix: "glass",
    frage: (r) => t("ui.quiz_frage_glas", { name: r.name }),
    erklaerung: (r, wert) => t("ui.quiz_erklaerung_glas", { name: r.name, wert }),
    difficulty: 2,
  });
}

// 6b. Rezept → Garnitur
function garniturFragen(rezepte) {
  return rezeptFeldFragen({
    rezepte,
    feld: "garnish",
    keyPrefix: "garnish",
    frage: (r) => t("ui.quiz_frage_garnitur", { name: r.name }),
    erklaerung: (r, wert) => t("ui.quiz_erklaerung_garnitur", { name: r.name, wert }),
    difficulty: 2,
  });
}

// 6c. Rezept → Methode
//
// Ablenker sind die Techniken der anderen Drinks derselben Kategorie; reicht
// das nicht, kommen die im Rezeptbuch vorhandenen Techniken dazu. Die
// Technikbezeichnungen sind ein geschlossenes Vokabular, keine Produktdaten.
function methodenFragen(rezepte) {
  const nachKategorie = gruppiere(rezepte, "category");
  const alleTechniken = [...new Set(rezepte.map((r) => methodenTechnik(r.method)).filter(Boolean))];
  const fragen = [];
  rezepte.forEach((recipe) => {
    const richtig = methodenTechnik(recipe.method);
    if (!richtig) return;
    const ausKategorie = (nachKategorie.get(txt(recipe.category)) ?? [])
      .filter((r) => r.name !== recipe.name)
      .map((r) => methodenTechnik(r.method))
      .filter(Boolean);
    const frage = baueFrage({
      key: `gen:method:${recipe.name}`,
      question: t("ui.quiz_frage_zubereitung", { name: recipe.name }),
      correct: richtig,
      candidates: [...ausKategorie, ...alleTechniken],
      explanation: txt(recipe.method) || `${recipe.name}: ${richtig}.`,
      topic: txt(recipe.category),
      difficulty: 1,
      refRecipe: recipe.name,
    });
    if (frage) fragen.push(frage);
  });
  return fragen;
}

// ---------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------

// Kompletter Fragenpool aus dem aktuellen Katalog. Jede Frage steht für sich
// (Text, Optionen, richtige Antwort, Erklärung, Thema, Sprungziel).
export function generateQuestions() {
  const produkte = gepruefteProdukte();
  const rezepte = rezepteMitKategorie();
  // Einmal pro Durchlauf bestimmen, welche Gruppen geteilt werden, statt für
  // jedes Produkt neu zu zählen.
  const geteilt = geteilteGruppen(produkte);
  const themaVon = (product) => quizThema(product, geteilt);
  return [
    ...abvFragen(produkte, themaVon),
    ...herkunftFragen(produkte, themaVon),
    ...rohstoffFragen(produkte, themaVon),
    ...verfahrenFragen(produkte, themaVon),
    ...aromaFragen(produkte, themaVon),
    ...weinFeldFragen(produkte, themaVon),
    ...jahrgangFragen(produkte, themaVon),
    ...zutatenFragen(rezepte),
    ...glasFragen(rezepte),
    ...garniturFragen(rezepte),
    ...methodenFragen(rezepte),
  ];
}

// Themen (Produktgruppen und Rezeptkategorien), zu denen es überhaupt Fragen
// gibt – Grundlage für die Auswahl in der Themenrunde.
export function listGeneratedTopics(pool) {
  const fragen = pool ?? generateQuestions();
  const zaehler = new Map();
  fragen.forEach((f) => {
    if (!f.topic) return;
    if (!zaehler.has(f.topic)) {
      zaehler.set(f.topic, { topic: f.topic, count: 0, group: txt(f.topicGroup) || f.topic });
    }
    zaehler.get(f.topic).count += 1;
  });
  return [...zaehler.values()].sort((a, b) => a.topic.localeCompare(b.topic, getLocale()));
}

// Zieht `anzahl` Fragen aus einem Pool, ohne Dubletten (question_key ist
// eindeutig) und optional auf ein Thema begrenzt.
export function pickQuestions(pool, anzahl, { topic = "" } = {}) {
  const gefiltert = topic ? pool.filter((f) => f.topic === topic) : pool;
  const gesehen = new Set();
  const auswahl = [];
  shuffle(gefiltert).forEach((frage) => {
    if (auswahl.length >= anzahl) return;
    if (gesehen.has(frage.key)) return;
    gesehen.add(frage.key);
    auswahl.push(frage);
  });
  return auswahl;
}
