import { generateQuestions } from "./quizGenerator.js";
import {
  loadQuizQuestions,
  reloadQuizQuestions,
  setQuizQuestionsActive,
  upsertQuizQuestions,
} from "./storage.js";

// Katalog-Abgleich der Quizfragen.
//
// Bis September 2026 baute der Generator seine Fragen bei jeder Runde neu im
// Browser. Sie waren dadurch nirgends zu greifen: nicht zu korrigieren, nicht
// abzuschalten, nicht anzuzeigen. Seitdem ist die Tabelle quiz_questions die
// einzige Fragenquelle, und dieser Abgleich füllt sie aus dem Katalog.
//
// Drei Regeln, an denen alles hängt:
//
//   1. Der question_key ("gen:abv:Bombay Sapphire Gin") ist über Läufe hinweg
//      stabil. Daran hängen quiz_attempts und die Schwierigkeitsmessung.
//   2. Eine von Hand geänderte Zeile (edited = true) wird nie überschrieben.
//      Wer eine Frage umformuliert, will sie nicht beim nächsten Lauf zurück.
//   3. Fragen, die es im Katalog nicht mehr gibt (Produkt gelöscht oder
//      verified entzogen), werden stillgelegt, nicht gelöscht – sonst
//      verlieren die Versuche der Kollegen ihren Bezug.

const BLOCK = 500;

// Der Generator mischt Optionen und zieht seine Ablenker zufällig: zwei Läufe
// liefern für dieselbe Frage verschiedene Antwortlisten. Verglichen wird
// deshalb nur, was inhaltlich etwas bedeutet – sonst schriebe jeder Lauf
// alle Zeilen neu.
function inhaltGleich(zeile, frage) {
  const richtigDb = zeile.options?.[zeile.correctIndex] ?? "";
  const richtigNeu = frage.options?.[frage.correctIndex] ?? "";
  return (
    zeile.question === frage.question &&
    richtigDb === richtigNeu &&
    zeile.explanation === frage.explanation &&
    zeile.topic === frage.topic &&
    (zeile.parentTopic || zeile.topic) === (frage.parent || frage.topic) &&
    zeile.refProduct === frage.refProduct &&
    zeile.refRecipe === frage.refRecipe
  );
}

function alsDatensatz(frage) {
  return {
    question_key: frage.key,
    question: frage.question,
    options: frage.options,
    correct_index: frage.correctIndex,
    explanation: frage.explanation ?? "",
    topic: frage.topic || "Servicewissen",
    parent_topic: frage.parent || frage.topic || null,
    difficulty: frage.difficulty ?? 2,
    ref_product: frage.refProduct || null,
    ref_recipe: frage.refRecipe || null,
    source: "generator",
    active: true,
  };
}

async function inBloecken(zeilen) {
  for (let i = 0; i < zeilen.length; i += BLOCK) {
    await upsertQuizQuestions(zeilen.slice(i, i + BLOCK));
  }
}

// Gleicht die Tabelle mit dem aktuellen Katalog ab und liefert die Bilanz
// des Laufs zurück. Wirft, wenn das Schreiben scheitert – der Aufrufer zeigt
// die Meldung an.
export async function syncGeneratedQuestions() {
  const pool = generateQuestions();
  const vorhanden = new Map(
    loadQuizQuestions()
      .filter((zeile) => zeile.source === "generator" && zeile.questionKey)
      .map((zeile) => [zeile.questionKey, zeile])
  );

  const schreiben = [];
  const wiederbeleben = [];
  let neu = 0;
  let geaendert = 0;
  let uebersprungen = 0;

  pool.forEach((frage) => {
    const zeile = vorhanden.get(frage.key);
    if (!zeile) {
      schreiben.push(alsDatensatz(frage));
      neu += 1;
      return;
    }
    if (zeile.edited) {
      uebersprungen += 1;
      // Eine von Hand bearbeitete Frage, die wieder im Katalog steht, darf
      // trotzdem zurück ins Quiz – nur ihr Text bleibt, wie er ist.
      if (!zeile.active) wiederbeleben.push(zeile.id);
      return;
    }
    if (inhaltGleich(zeile, frage)) {
      if (!zeile.active) wiederbeleben.push(zeile.id);
      return;
    }
    schreiben.push(alsDatensatz(frage));
    geaendert += 1;
  });

  const imKatalog = new Set(pool.map((frage) => frage.key));
  const stilllegen = [...vorhanden.values()]
    .filter((zeile) => zeile.active && !imKatalog.has(zeile.questionKey))
    .map((zeile) => zeile.id);

  await inBloecken(schreiben);
  await setQuizQuestionsActive(stilllegen, false);
  await setQuizQuestionsActive(wiederbeleben, true);
  await reloadQuizQuestions();

  return {
    imKatalog: pool.length,
    neu,
    geaendert,
    stillgelegt: stilllegen.length,
    wiederbelebt: wiederbeleben.length,
    uebersprungen,
  };
}
