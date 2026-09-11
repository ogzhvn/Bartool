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
// Eine Themen-Einheit muss genug Produkte haben, um Ablenker zu liefern:
// richtige Antwort + MIN_ABLENKER.
const MIN_THEMA_PRODUKTE = MIN_ABLENKER + 1;
// Längste Antwortoption. Die Wein-Felder enthalten teils ganze Sätze
// ("Ausbau im Tank und im Eichenfass, teils gebrauchte Barriques ..."); als
// Antwortoption hinterm Tresen ist das unlesbar, also fällt es weg.
const MAX_OPTION_LEN = 60;
// Datenpflege-Hinweise im Feld sind keine Antwort, sondern eine Aufgabe für
// den Wareneingang ("genaue DOC-Angabe vom Etikett übernehmen").
const HINWEIS_MUSTER = /pr\u00fcf|etikett|nicht dokumentiert|erg\u00e4nzen/i;
// Unter so vielen verschiedenen Jahrgängen in der Themen-Einheit rät sich
// eine Jahrgangsfrage von selbst (Ablenker wären Nachbarjahre).
const MIN_JAHRGAENGE = 4;
// Mindestabstand zwischen Platz 1 und Platz 2 bei der Alkohol-Vergleichsfrage.
// Liegen zwei Flaschen dichter beieinander, ist die Frage Glückssache.
const MIN_ABV_ABSTAND = 2;
// Geschlossenes Vokabular für die Mengenfrage: die Standardmengen hinterm
// Tresen in ml. Ablenker kommen ausschließlich aus dieser Liste, nie aus
// anderen Rezepten – sonst stünde im Zweifel eine Menge zur Wahl, die es in
// diesem Drink gar nicht gibt.
const STANDARD_MENGEN_ML = [5, 10, 15, 20, 25, 30, 40, 45, 50, 60];

function txt(value) {
  return String(value ?? "").trim();
}

function normKey(value) {
  return txt(value).toLowerCase();
}

// Wert, der als Antwortoption taugt: kurz genug für eine Zeile und ohne
// Datenpflege-Hinweis. Alles andere ergibt keine Frage statt einer schlechten.
function kurzOption(value) {
  const wert = txt(value);
  if (!wert || wert.length > MAX_OPTION_LEN) return "";
  return HINWEIS_MUSTER.test(wert) ? "" : wert;
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
function baueFrage({ key, question, correct, candidates, explanation, topic, parent, difficulty, refProduct, refRecipe }) {
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
    // Oberkategorie des Themas – gruppiert die Themenliste im Quiz-Tab.
    parent: txt(parent) || topic,
    difficulty: difficulty ?? 2,
    refProduct: refProduct ?? "",
    refRecipe: refRecipe ?? "",
    source: "generator",
  };
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

// Welche Produktgruppen werden für das Quiz in ihre Untergruppen zerlegt?
//
// Hintergrund: `sub_group` ist fast überall gesetzt, aber sehr unterschiedlich
// gemeint. Bei Wein sind es echte Kategorien (Rotwein, Weißwein, Roséwein) mit
// je genug Flaschen. Bei Whisky oder Rum sind es Herkunftsschubladen, in denen
// teils nur eine einzige Flasche steht – zerlegt man die, bleiben keine
// Ablenker übrig und die Fragen verschwinden ersatzlos.
//
// Deshalb gilt: eine Gruppe wird nur dann ganz nach Untergruppen zerlegt, wenn
// es mindestens zwei Untergruppen gibt, jede davon genug Produkte hat und kein
// Produkt der Gruppe ohne Untergruppe dasteht. Sonst bleibt die Gruppe selbst
// das Thema. Heute trifft das genau auf Wein zu.
export function themenSchnitt(produkte) {
  const proGruppe = new Map();
  produkte.forEach((p) => {
    const gruppe = txt(p.group);
    if (!gruppe) return;
    if (!proGruppe.has(gruppe)) proGruppe.set(gruppe, new Map());
    const unter = proGruppe.get(gruppe);
    const schluessel = txt(p.subGroup);
    unter.set(schluessel, (unter.get(schluessel) ?? 0) + 1);
  });

  const zerlegt = new Set();
  proGruppe.forEach((unter, gruppe) => {
    if (unter.has("")) return;
    if (unter.size < 2) return;
    const tragfaehig = [...unter.values()].every((anzahl) => anzahl >= MIN_THEMA_PRODUKTE);
    if (tragfaehig) zerlegt.add(gruppe);
  });
  return zerlegt;
}

// Thema eines Produkts: die Untergruppe, wenn die Gruppe zerlegt wird, sonst
// die Gruppe. Ohne `zerlegt` (z. B. im Einzeltest) immer die Gruppe.
export function quizThema(product, zerlegt) {
  const gruppe = txt(product?.group);
  const unter = txt(product?.subGroup);
  return unter && zerlegt?.has(gruppe) ? unter : gruppe;
}

// Nur geprüfte Produkte mit Gruppenzuordnung: ohne Gruppe gibt es keine
// saubere Ablenkerauswahl. `quizTopic` ist das Thema der Frage und zugleich
// die Einheit, aus der die Ablenker kommen; `quizParent` bleibt die Gruppe.
function gepruefteProdukte() {
  const basis = getAllProducts().filter((p) => p?.verified === true && txt(p.group));
  const zerlegt = themenSchnitt(basis);
  return basis.map((p) => ({ ...p, quizTopic: quizThema(p, zerlegt), quizParent: txt(p.group) }));
}

function abvZahl(value) {
  const zahl = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(zahl) && zahl > 0 ? zahl : null;
}

function formatAbv(value) {
  const zahl = abvZahl(value);
  return zahl === null ? "" : `${formatNumberLocal(zahl)} % vol`;
}

// Erklärung nach der Antwort: der Fakt selbst, ergänzt um den Quick Pitch,
// wenn einer gepflegt ist.
function mitPitch(product, satz) {
  const pitch = txt(product.quickPitch);
  return pitch ? `${satz} ${pitch}` : satz;
}

// Gemeinsames Gerüst für alle Fragen "ein Feld eines Produkts erraten".
function feldFragen({ produkte, feld, keyPrefix, frage, erklaerung, formatiere, difficulty }) {
  const nachThema = gruppiere(produkte, "quizTopic");
  const fragen = [];
  produkte.forEach((product) => {
    const richtig = formatiere ? formatiere(product[feld]) : txt(product[feld]);
    if (!richtig) return;
    const kandidaten = (nachThema.get(txt(product.quizTopic)) ?? [])
      .filter((p) => p.name !== product.name)
      .map((p) => (formatiere ? formatiere(p[feld]) : txt(p[feld])));
    const frageObjekt = baueFrage({
      key: `gen:${keyPrefix}:${product.name}`,
      question: frage(product),
      correct: richtig,
      candidates: kandidaten,
      explanation: erklaerung(product, richtig),
      topic: txt(product.quizTopic),
      parent: product.quizParent,
      difficulty,
      refProduct: product.name,
    });
    if (frageObjekt) fragen.push(frageObjekt);
  });
  return fragen;
}

// 1. Alkoholgehalt
function abvFragen(produkte) {
  return feldFragen({
    produkte,
    feld: "abvValue",
    keyPrefix: "abv",
    frage: (p) => t("ui.quiz_frage_abv", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_abv", { name: p.name, wert })),
    formatiere: formatAbv,
    difficulty: 2,
  });
}

// 2. Herkunftsland
function herkunftFragen(produkte) {
  return feldFragen({
    produkte,
    feld: "originCountry",
    keyPrefix: "country",
    frage: (p) => t("ui.quiz_frage_land", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_land", { name: p.name, wert })),
    difficulty: 1,
  });
}

// 3. Rohstoff
function rohstoffFragen(produkte) {
  return feldFragen({
    produkte,
    feld: "baseMaterial",
    keyPrefix: "base",
    frage: (p) => t("ui.quiz_frage_grundstoff", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_grundstoff", { name: p.name, wert })),
    difficulty: 2,
  });
}

// 7. Herstellungsverfahren
function verfahrenFragen(produkte) {
  return feldFragen({
    produkte,
    feld: "productionMethod",
    keyPrefix: "production",
    frage: (p) => t("ui.quiz_frage_verfahren", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_verfahren", { name: p.name, wert })),
    difficulty: 3,
  });
}

// 8. Wein- und Schaumweinwissen
//
// Alle diese Felder sind seit Paket 25 gepflegt, stehen aber nicht überall und
// enthalten teils ganze Sätze. `kurzOption` sortiert aus, was als Antwort nicht
// taugt; bleiben zu wenige Ablenker übrig, entsteht einfach keine Frage.
function rebsorteFragen(produkte) {
  return feldFragen({
    produkte,
    feld: "grapeVariety",
    keyPrefix: "grape",
    frage: (p) => t("ui.quiz_frage_rebsorte", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_rebsorte", { name: p.name, wert })),
    formatiere: kurzOption,
    difficulty: 2,
  });
}

function regionFragen(produkte) {
  return feldFragen({
    produkte,
    feld: "region",
    keyPrefix: "region",
    frage: (p) => t("ui.quiz_frage_region", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_region", { name: p.name, wert })),
    formatiere: kurzOption,
    difficulty: 2,
  });
}

function erzeugerFragen(produkte) {
  return feldFragen({
    produkte,
    feld: "producer",
    keyPrefix: "producer",
    frage: (p) => t("ui.quiz_frage_erzeuger", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_erzeuger", { name: p.name, wert })),
    formatiere: kurzOption,
    difficulty: 3,
  });
}

function suesseFragen(produkte) {
  return feldFragen({
    produkte,
    feld: "sweetness",
    keyPrefix: "sweet",
    frage: (p) => t("ui.quiz_frage_suesse", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_suesse", { name: p.name, wert })),
    formatiere: kurzOption,
    difficulty: 1,
  });
}

function ausbauFragen(produkte) {
  return feldFragen({
    produkte,
    feld: "aging",
    keyPrefix: "aging",
    frage: (p) => t("ui.quiz_frage_ausbau", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_ausbau", { name: p.name, wert })),
    formatiere: kurzOption,
    difficulty: 3,
  });
}

function temperaturFragen(produkte) {
  return feldFragen({
    produkte,
    feld: "servingTemp",
    keyPrefix: "temp",
    frage: (p) => t("ui.quiz_frage_temperatur", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_temperatur", { name: p.name, wert })),
    formatiere: kurzOption,
    difficulty: 2,
  });
}

function klassifikationFragen(produkte) {
  return feldFragen({
    produkte,
    feld: "classification",
    keyPrefix: "class",
    frage: (p) => t("ui.quiz_frage_klassifikation", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_klassifikation", { name: p.name, wert })),
    formatiere: kurzOption,
    difficulty: 3,
  });
}

function koerperFragen(produkte) {
  return feldFragen({
    produkte,
    feld: "body",
    keyPrefix: "body",
    frage: (p) => t("ui.quiz_frage_koerper", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_koerper", { name: p.name, wert })),
    formatiere: kurzOption,
    difficulty: 2,
  });
}

// 10. Weitere gepflegte Produktfelder (Paket 42)
//
// Dieselbe Mechanik wie oben, nur andere Felder. Alle laufen durch
// `kurzOption`: `service` und `ageStatement` sind oft ganze Sätze, die als
// Antwortoption nicht taugen – dann entsteht schlicht keine Frage.
function serviceFragen(produkte) {
  return feldFragen({
    produkte,
    feld: "service",
    keyPrefix: "service",
    frage: (p) => t("ui.quiz_frage_service", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_service", { name: p.name, wert })),
    formatiere: kurzOption,
    difficulty: 2,
  });
}

function allergenFragen(produkte) {
  return feldFragen({
    produkte,
    feld: "allergens",
    keyPrefix: "allergen",
    frage: (p) => t("ui.quiz_frage_allergene", { name: p.name }),
    erklaerung: (p, wert) => t("ui.quiz_erklaerung_allergene", { name: p.name, wert }),
    formatiere: kurzOption,
    difficulty: 2,
  });
}

function altersangabeFragen(produkte) {
  return feldFragen({
    produkte,
    feld: "ageStatement",
    keyPrefix: "age",
    frage: (p) => t("ui.quiz_frage_alter", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_alter", { name: p.name, wert })),
    formatiere: kurzOption,
    difficulty: 3,
  });
}

function herkunftsregionFragen(produkte) {
  return feldFragen({
    produkte,
    feld: "originRegion",
    keyPrefix: "originregion",
    frage: (p) => t("ui.quiz_frage_herkunftsregion", { name: p.name }),
    erklaerung: (p, wert) => mitPitch(p, t("ui.quiz_erklaerung_herkunftsregion", { name: p.name, wert })),
    formatiere: kurzOption,
    difficulty: 3,
  });
}

// 11. Einsatz im Drink (`pairsWith`)
//
// `pairsWith` ist eine Liste von Drinknamen, kein Textfeld – also kein
// `feldFragen()`. Der heikle Punkt ist die zweite richtige Antwort: ein
// Ablenker-Drink, der das Produkt in Wahrheit auch enthält. Deshalb fliegt
// jeder Drink raus, der entweder in der eigenen `pairsWith`-Liste steht oder
// laut Rezeptbuch das Produkt als Zutat führt (derselbe Teilstring-Vergleich
// wie im Rest des Tools).
function einsatzFragen(produkte, rezepte) {
  const nachThema = gruppiere(produkte, "quizTopic");
  const fragen = [];

  const drinkNamen = (product) => {
    const nadel = normKey(product.name);
    if (!nadel) return new Set();
    const treffer = rezepte.filter((r) =>
      (r.ingredients ?? []).some((i) => normKey(i?.name).includes(nadel))
    );
    return new Set(treffer.map((r) => normKey(r.name)));
  };

  const liste = (product) =>
    (Array.isArray(product.pairsWith) ? product.pairsWith : []).map((wert) => kurzOption(wert)).filter(Boolean);

  produkte.forEach((product) => {
    const eigene = liste(product);
    if (eigene.length === 0) return;
    const sortiert = [...eigene].sort((a, b) => a.localeCompare(b, getLocale()));
    const richtig = sortiert[streuIndex(product.name, sortiert.length)];
    const tabu = new Set([...eigene.map(normKey), ...drinkNamen(product)]);
    const kandidaten = (nachThema.get(txt(product.quizTopic)) ?? [])
      .filter((p) => p.name !== product.name)
      .flatMap((p) => liste(p))
      .filter((name) => !tabu.has(normKey(name)));
    const frage = baueFrage({
      key: `gen:pairs:${product.name}`,
      question: t("ui.quiz_frage_einsatz", { name: product.name }),
      correct: richtig,
      candidates: kandidaten,
      explanation: mitPitch(product, t("ui.quiz_erklaerung_einsatz", { name: product.name, wert: eigene.join(", ") })),
      topic: txt(product.quizTopic),
      parent: product.quizParent,
      difficulty: 2,
      refProduct: product.name,
    });
    if (frage) fragen.push(frage);
  });
  return fragen;
}

// 12. Vergleichsfrage: wer hat den höchsten Alkoholgehalt?
//
// Innerhalb einer Themen-Einheit nach `abvValue` sortiert, dann in Vierer-
// fenstern durchgegangen. Gefragt wird nur, wenn Platz 1 mindestens
// MIN_ABV_ABSTAND % vol vor Platz 2 liegt – sonst ist die Frage unfair.
function abvVergleichFragen(produkte) {
  const fragen = [];
  gruppiere(produkte, "quizTopic").forEach((liste, thema) => {
    const sortiert = liste
      .map((p) => ({ p, abv: abvZahl(p.abvValue) }))
      .filter((e) => e.abv !== null)
      .sort((a, b) => b.abv - a.abv || a.p.name.localeCompare(b.p.name, getLocale()));
    for (let i = 0; i + 4 <= sortiert.length; i += 1) {
      const fenster = sortiert.slice(i, i + 4);
      if (fenster[0].abv - fenster[1].abv < MIN_ABV_ABSTAND) continue;
      const sieger = fenster[0];
      const frage = baueFrage({
        key: `gen:abvtop:${sieger.p.name}`,
        question: t("ui.quiz_frage_abv_hoechste", { gruppe: thema }),
        correct: sieger.p.name,
        candidates: fenster.slice(1).map((e) => e.p.name),
        explanation: t("ui.quiz_erklaerung_abv_hoechste", {
          name: sieger.p.name,
          wert: formatAbv(sieger.abv),
          zweiter: fenster[1].p.name,
          wert2: formatAbv(fenster[1].abv),
        }),
        topic: thema,
        parent: sieger.p.quizParent,
        difficulty: 2,
        refProduct: sieger.p.name,
      });
      if (frage) fragen.push(frage);
    }
  });
  return fragen;
}

// 13. Zuordnung: in welche Gruppe gehört das Produkt?
//
// Einzige Frage, deren Ablenker bewusst **nicht** aus der eigenen Themen-
// Einheit kommen – gefragt ist ja gerade die Einheit. Die Ablenker sind echte
// Gruppennamen aus dem Katalog, bevorzugt aus derselben Oberkategorie
// (Rotwein/Weißwein/Roséwein), damit die Frage nicht durch Ausschluss fällt.
function gruppenFragen(produkte) {
  const themen = new Map();
  produkte.forEach((p) => {
    const thema = txt(p.quizTopic);
    if (thema && !themen.has(thema)) themen.set(thema, txt(p.quizParent));
  });
  const alle = [...themen.keys()];
  const fragen = [];
  produkte.forEach((product) => {
    const eigenes = txt(product.quizTopic);
    if (!eigenes) return;
    const andere = alle.filter((thema) => thema !== eigenes);
    const nah = andere.filter((thema) => themen.get(thema) === txt(product.quizParent));
    const frage = baueFrage({
      key: `gen:group:${product.name}`,
      question: t("ui.quiz_frage_gruppe", { name: product.name }),
      correct: eigenes,
      candidates: [...shuffle(nah), ...shuffle(andere)],
      explanation: mitPitch(product, t("ui.quiz_erklaerung_gruppe", { name: product.name, wert: eigenes })),
      topic: eigenes,
      parent: product.quizParent,
      difficulty: 1,
      refProduct: product.name,
    });
    if (frage) fragen.push(frage);
  });
  return fragen;
}

// 9. Jahrgang – nur mit Bremse
//
// Ablenker sind hier zwangsläufig andere Jahreszahlen. Stehen in der
// Themen-Einheit nur zwei oder drei verschiedene Jahrgänge, ist die Frage durch
// Ausschluss lösbar und damit wertlos. Deshalb erst ab MIN_JAHRGAENGE und
// grundsätzlich als schwere Frage.
function jahrgangFragen(produkte) {
  const nachThema = gruppiere(produkte, "quizTopic");
  const fragen = [];
  produkte.forEach((product) => {
    const richtig = kurzOption(product.vintage);
    if (!richtig) return;
    const geschwister = (nachThema.get(txt(product.quizTopic)) ?? []).filter((p) => p.name !== product.name);
    const jahrgaenge = [...new Set([product, ...geschwister].map((p) => kurzOption(p.vintage)).filter(Boolean))];
    if (jahrgaenge.length < MIN_JAHRGAENGE) return;
    const frage = baueFrage({
      key: `gen:vintage:${product.name}`,
      question: t("ui.quiz_frage_jahrgang", { name: product.name }),
      correct: richtig,
      candidates: geschwister.map((p) => kurzOption(p.vintage)),
      explanation: mitPitch(product, t("ui.quiz_erklaerung_jahrgang", { name: product.name, wert: richtig })),
      topic: txt(product.quizTopic),
      parent: product.quizParent,
      difficulty: 3,
      refProduct: product.name,
    });
    if (frage) fragen.push(frage);
  });
  return fragen;
}

// 4. Tasting Notes → welches Produkt passt
//
// Umgekehrte Richtung: die Aromen sind die Frage, gesucht ist das Produkt.
// Ablenker sind Produkte derselben Gruppe, deren Aromen sich nicht mit den
// genannten überschneiden – sonst gäbe es zwei richtige Antworten.
function aromaFragen(produkte) {
  const nachThema = gruppiere(produkte, "quizTopic");
  const fragen = [];
  produkte.forEach((product) => {
    const tags = (Array.isArray(product.flavorTags) ? product.flavorTags : [])
      .map((wert) => txt(wert))
      .filter(Boolean);
    if (tags.length < 2) return;
    const eigene = new Set(tags.map(normKey));
    const kandidaten = (nachThema.get(txt(product.quizTopic)) ?? [])
      .filter((p) => p.name !== product.name)
      .filter((p) => {
        const fremde = Array.isArray(p.flavorTags) ? p.flavorTags : [];
        return !fremde.some((wert) => eigene.has(normKey(wert)));
      })
      .map((p) => p.name);
    const frage = baueFrage({
      key: `gen:notes:${product.name}`,
      question: t("ui.quiz_frage_aroma", { gruppe: txt(product.quizTopic), tags: tags.join(", ") }),
      correct: product.name,
      candidates: kandidaten,
      explanation: mitPitch(product, `${product.name}: ${tags.join(", ")}.`),
      topic: txt(product.quizTopic),
      parent: product.quizParent,
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

// Oberkategorie aller Rezeptfragen. Als Funktion, weil die Sprache zur
// Laufzeit umgeschaltet werden kann.
function REZEPT_OBERTHEMA() {
  return t("ui.rezepte");
}

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
      parent: REZEPT_OBERTHEMA(),
      difficulty,
      refRecipe: recipe.name,
    });
    if (frageObjekt) fragen.push(frageObjekt);
  });
  return fragen;
}

// Zutatennamen eines Rezepts, ohne Dubletten. Kommt ein Name doppelt vor
// (zwei Zeilen "Limettensaft" mit verschiedenen Mengen), fällt er ganz raus:
// sonst hätte die Mengenfrage zwei richtige Antworten.
function zutatenNamen(recipe) {
  const zaehler = new Map();
  (recipe.ingredients ?? []).forEach((i) => {
    const name = txt(i?.name);
    if (!name) return;
    zaehler.set(normKey(name), (zaehler.get(normKey(name)) ?? 0) + 1);
  });
  const gesehen = new Set();
  const namen = [];
  (recipe.ingredients ?? []).forEach((i) => {
    const name = txt(i?.name);
    if (!name || zaehler.get(normKey(name)) !== 1 || gesehen.has(normKey(name))) return;
    gesehen.add(normKey(name));
    namen.push(name);
  });
  return namen;
}

// Stabile Streuung: aus einem Text immer dieselbe Zahl. Wird gebraucht, wo
// aus mehreren gleichwertigen Möglichkeiten eine gewählt werden muss und die
// Wahl über Sessions hinweg gleich bleiben soll (der question_key bezeichnet
// sonst mal diese, mal jene Frage). Alphabetisch zu wählen wäre auch stabil,
// träfe aber überall dieselbe Zutat – nach zwei Runden wüsste das Team, dass
// die Antwort "Absinth" lautet.
function streuIndex(text, laenge) {
  if (laenge <= 0) return 0;
  let hash = 5381;
  const wert = txt(text);
  for (let i = 0; i < wert.length; i += 1) hash = ((hash * 33) ^ wert.charCodeAt(i)) >>> 0;
  return hash % laenge;
}

// Zwei Zutatennamen, die sich überschneiden ("Limette" / "Limettensaft"),
// dürfen nie als richtige Antwort und Ablenker nebeneinander stehen.
function ueberschneidet(a, b) {
  const x = normKey(a);
  const y = normKey(b);
  return Boolean(x) && Boolean(y) && (x.includes(y) || y.includes(x));
}

// 5. Rezept → Zutat
//
// Gefragt wird eine Zutat des Drinks, die Ablenker sind Zutaten anderer
// Drinks derselben Kategorie, die in diesem Rezept nicht vorkommen.
//
// Seit Paket 42 wird jede Zutat einzeln gefragt, nicht mehr nur die erste.
// Der question_key heißt deshalb `gen:ingredient:<Rezept>:<Zutat>`; die alten
// Keys `gen:ingredient:<Rezept>` gibt es nicht mehr.
function zutatenFragen(rezepte) {
  const nachKategorie = gruppiere(rezepte, "category");
  const fragen = [];
  rezepte.forEach((recipe) => {
    const zutaten = zutatenNamen(recipe);
    if (zutaten.length === 0) return;
    const kandidaten = [];
    (nachKategorie.get(txt(recipe.category)) ?? [])
      .filter((r) => r.name !== recipe.name)
      .forEach((r) => {
        zutatenNamen(r).forEach((name) => {
          if (!zutaten.some((eigen) => ueberschneidet(eigen, name))) kandidaten.push(name);
        });
      });
    zutaten.forEach((richtig) => {
      const frage = baueFrage({
        key: `gen:ingredient:${recipe.name}:${richtig}`,
        question: t("ui.quiz_frage_zutaten", { name: recipe.name }),
        correct: richtig,
        candidates: kandidaten,
        explanation: `${recipe.name}: ${zutaten.join(", ")}.`,
        topic: txt(recipe.category),
        parent: REZEPT_OBERTHEMA(),
        difficulty: 1,
        refRecipe: recipe.name,
      });
      if (frage) fragen.push(frage);
    });
  });
  return fragen;
}

// 14. Negativfrage: welche Zutat gehört **nicht** rein?
//
// Hier sind die Rollen vertauscht: die gesuchte Antwort ist die fremde Zutat,
// die drei Ablenker sind echte Zutaten des Drinks. Die fremde Zutat kommt aus
// einem anderen Drink derselben Kategorie und darf sich mit keiner eigenen
// Zutat überschneiden. Sie wird alphabetisch gewählt, damit der question_key
// über Sessions hinweg dieselbe Frage bezeichnet.
function negativFragen(rezepte) {
  const nachKategorie = gruppiere(rezepte, "category");
  const fragen = [];
  rezepte.forEach((recipe) => {
    const zutaten = zutatenNamen(recipe);
    if (zutaten.length < MIN_ABLENKER) return;
    const fremde = new Set();
    (nachKategorie.get(txt(recipe.category)) ?? [])
      .filter((r) => r.name !== recipe.name)
      .forEach((r) => {
        zutatenNamen(r).forEach((name) => {
          if (!zutaten.some((eigen) => ueberschneidet(eigen, name))) fremde.add(name);
        });
      });
    const sortiert = [...fremde].sort((a, b) => a.localeCompare(b, getLocale()));
    const richtig = sortiert[streuIndex(recipe.name, sortiert.length)];
    if (!richtig) return;
    const frage = baueFrage({
      key: `gen:notin:${recipe.name}`,
      question: t("ui.quiz_frage_negativ", { name: recipe.name }),
      correct: richtig,
      candidates: zutaten,
      explanation: t("ui.quiz_erklaerung_negativ", {
        name: recipe.name,
        zutaten: zutaten.join(", "),
        wert: richtig,
      }),
      topic: txt(recipe.category),
      parent: REZEPT_OBERTHEMA(),
      difficulty: 2,
      refRecipe: recipe.name,
    });
    if (frage) fragen.push(frage);
  });
  return fragen;
}

// 15. Umkehrfrage: in welchem Drink steckt diese Zutat?
//
// Nur mit Zutaten, die in genau einem Rezept der Kategorie vorkommen – sonst
// gäbe es zwei richtige Antworten. Zusätzlich fliegt jeder Ablenker-Drink
// raus, der eine Zutat mit überschneidendem Namen führt ("Limette" gegen
// "Limettensaft").
function umkehrFragen(rezepte) {
  const fragen = [];
  gruppiere(rezepte, "category").forEach((liste, kategorie) => {
    const vorkommen = new Map();
    liste.forEach((recipe) => {
      zutatenNamen(recipe).forEach((name) => {
        if (!vorkommen.has(normKey(name))) vorkommen.set(normKey(name), { name, rezepte: [] });
        vorkommen.get(normKey(name)).rezepte.push(recipe);
      });
    });
    vorkommen.forEach((eintrag) => {
      if (eintrag.rezepte.length !== 1) return;
      const recipe = eintrag.rezepte[0];
      const kandidaten = liste
        .filter((r) => r.name !== recipe.name)
        .filter((r) => !zutatenNamen(r).some((name) => ueberschneidet(name, eintrag.name)))
        .map((r) => r.name);
      const frage = baueFrage({
        key: `gen:drinkfor:${kategorie}:${eintrag.name}`,
        question: t("ui.quiz_frage_umkehr", { kategorie, zutat: eintrag.name }),
        correct: recipe.name,
        candidates: kandidaten,
        explanation: `${recipe.name}: ${zutatenNamen(recipe).join(", ")}.`,
        topic: kategorie,
        parent: REZEPT_OBERTHEMA(),
        difficulty: 2,
        refRecipe: recipe.name,
      });
      if (frage) fragen.push(frage);
    });
  });
  return fragen;
}

// 16. Mengenfrage
//
// Nur für Zutaten in ml, deren Menge im Standardvokabular steht. Die Ablenker
// sind die drei nächstgelegenen Standardmengen – nie Werte aus anderen
// Rezepten, damit keine erfundene Menge auf der Karte steht.
//
// Höchstens MENGEN_PRO_REZEPT Zutaten je Drink: fragt man jede ml-Zutat ab,
// besteht eine Zehnerrunde schnell zur Hälfte aus "Wie viel … kommt in …?".
// Welche Zutaten es werden, entscheidet `streuIndex` – stabil, aber nicht
// überall die Basisspirituose.
const MENGEN_PRO_REZEPT = 2;

function mengenFragen(rezepte) {
  const fragen = [];
  const alsText = (wert) => `${formatNumberLocal(wert)} ml`;
  rezepte.forEach((recipe) => {
    const erlaubt = new Set(zutatenNamen(recipe).map(normKey));
    const geeignet = (recipe.ingredients ?? [])
      .map((zutat) => ({ name: txt(zutat?.name), unit: normKey(zutat?.unit), menge: Number(String(zutat?.amount ?? "").replace(",", ".")) }))
      .filter((e) => e.name && erlaubt.has(normKey(e.name)) && e.unit === "ml" && STANDARD_MENGEN_ML.includes(e.menge))
      .sort((a, b) => a.name.localeCompare(b.name, getLocale()));
    if (geeignet.length === 0) return;
    const start = streuIndex(recipe.name, geeignet.length);
    const auswahl = [];
    for (let i = 0; i < Math.min(MENGEN_PRO_REZEPT, geeignet.length); i += 1) {
      auswahl.push(geeignet[(start + i) % geeignet.length]);
    }
    auswahl.forEach(({ name, menge }) => {
      const nachbarn = STANDARD_MENGEN_ML.filter((m) => m !== menge)
        .sort((a, b) => Math.abs(a - menge) - Math.abs(b - menge))
        .slice(0, MIN_ABLENKER);
      const frage = baueFrage({
        key: `gen:amount:${recipe.name}:${name}`,
        question: t("ui.quiz_frage_menge", { zutat: name, name: recipe.name }),
        correct: alsText(menge),
        candidates: nachbarn.map(alsText),
        explanation: t("ui.quiz_erklaerung_menge", { name: recipe.name, wert: alsText(menge), zutat: name }),
        topic: txt(recipe.category),
        parent: REZEPT_OBERTHEMA(),
        difficulty: 2,
        refRecipe: recipe.name,
      });
      if (frage) fragen.push(frage);
    });
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

// 6d. Rezept → Eis
function eisFragen(rezepte) {
  return rezeptFeldFragen({
    rezepte,
    feld: "ice",
    keyPrefix: "ice",
    frage: (r) => t("ui.quiz_frage_eis", { name: r.name }),
    erklaerung: (r, wert) => t("ui.quiz_erklaerung_eis", { name: r.name, wert }),
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
      parent: REZEPT_OBERTHEMA(),
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
  return [
    ...abvFragen(produkte),
    ...herkunftFragen(produkte),
    ...rohstoffFragen(produkte),
    ...verfahrenFragen(produkte),
    ...aromaFragen(produkte),
    ...rebsorteFragen(produkte),
    ...regionFragen(produkte),
    ...erzeugerFragen(produkte),
    ...suesseFragen(produkte),
    ...ausbauFragen(produkte),
    ...temperaturFragen(produkte),
    ...klassifikationFragen(produkte),
    ...koerperFragen(produkte),
    ...jahrgangFragen(produkte),
    ...serviceFragen(produkte),
    ...allergenFragen(produkte),
    ...altersangabeFragen(produkte),
    ...herkunftsregionFragen(produkte),
    ...einsatzFragen(produkte, rezepte),
    ...abvVergleichFragen(produkte),
    ...gruppenFragen(produkte),
    ...zutatenFragen(rezepte),
    ...glasFragen(rezepte),
    ...garniturFragen(rezepte),
    ...eisFragen(rezepte),
    ...methodenFragen(rezepte),
    ...negativFragen(rezepte),
    ...umkehrFragen(rezepte),
    ...mengenFragen(rezepte),
  ];
}

// Themen (Produktgruppen und Rezeptkategorien), zu denen es überhaupt Fragen
// gibt – Grundlage für die Auswahl in der Themenrunde.
export function listGeneratedTopics(pool) {
  const fragen = pool ?? generateQuestions();
  const zaehler = new Map();
  fragen.forEach((f) => {
    if (!f.topic) return;
    if (!zaehler.has(f.topic)) zaehler.set(f.topic, { topic: f.topic, count: 0, parent: txt(f.parent) || f.topic });
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
