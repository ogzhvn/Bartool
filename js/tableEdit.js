import { t } from "./i18n.js";

// Bearbeiten in der Zelle – gemeinsam für die Katalogtabelle
// (js/adminTable.js) und die Fragentabelle (js/quizTable.js).
//
// Beide Tabellen sind gleich aufgebaut: eine Zeile je Eintrag, jede Zelle
// trägt ihre Koordinaten (data-name bzw. data-id plus data-field), und die
// Spaltendefinition sagt über `type`, was in der Zelle steht. Genau daraus
// baut dieses Modul das passende Eingabeelement. Was die beiden Tabellen
// unterscheidet – wie ein Eintrag gefunden und wie er gespeichert wird –
// kommt über die Konfiguration herein, nicht über Sonderfälle hier drin.
//
// Ablauf einer Änderung:
//   Klick in die Zelle   → Eingabeelement, Wert vorbelegt und markiert
//   Verlassen oder Enter → Wert prüfen, Zelle schließen, im Hintergrund speichern
//   Tab                  → speichern und weiter zur nächsten Zelle der Zeile
//   Esc                  → verwerfen
//
// Fehler bleiben an der Zelle stehen (rote Markierung, Grund im title), bis
// derselbe Wert erfolgreich gespeichert oder verworfen wurde. Ein Fehler darf
// nicht verschwinden, nur weil die Tabelle zwischendurch neu gezeichnet wurde –
// deshalb liegt der Fehlerspeicher hier und nicht im DOM, und die Tabellen
// rufen nach jedem Rendern zeichneFehlerNeu() auf.

// Diese Spaltentypen lassen sich in der Zelle bearbeiten. Alles andere
// (readonly, date) bleibt gesperrt: Name, Frage, Zutaten, "passt gut zu",
// Antworten und Zeitstempel gehören ins Formular bzw. gar nicht geändert.
// Einzelne Spalten können sich zusätzlich mit `editierbar: false` sperren –
// für Felder, die zwar einen bearbeitbaren Typ haben, aber von der Anwendung
// selbst gesetzt werden (z. B. "bearbeitet" bei den Quizfragen).
const EDITIERBAR = new Set(["text", "longtext", "number", "bool", "tags", "select"]);

// Sichtbare Länge einer Textzelle – der volle Text hängt im title.
const CELL_MAX = 120;

const tabellen = new Map();
const fehler = new Map();
const endeCallbacks = [];

let aktiv = null;
let laufendeSpeicher = 0;
let vorschlagListe = null;
// Geschrieben wird immer der ganze Datensatz, nicht das einzelne Feld. Liefen
// zwei Änderungen derselben Zeile gleichzeitig, würde die zweite die erste
// zurückdrehen – sie hätte den Stand von vor dem ersten Schreiben in der Hand.
// Deshalb hängen alle Schreibvorgänge an einer Kette, und jeder holt sich den
// Eintrag erst, wenn er an der Reihe ist (siehe speichern() der Tabellen).
let speicherKette = Promise.resolve();

export function istSpalteEditierbar(spalte) {
  return Boolean(spalte) && EDITIERBAR.has(spalte.type) && spalte.editierbar !== false;
}

// Zelleninhalt setzen – gekürzt, voller Text im title. Beide Tabellen nutzen
// dieselbe Regel, damit eine frisch gespeicherte Zelle genauso aussieht wie
// eine frisch gezeichnete.
export function setzeZellInhalt(td, text) {
  const wert = text ?? "";
  if (wert.length > CELL_MAX) {
    td.textContent = `${wert.slice(0, CELL_MAX)}…`;
    td.title = wert;
  } else {
    td.textContent = wert;
    td.removeAttribute("title");
  }
}

// Solange eine Zelle offen ist oder ein Speichern läuft, darf die Tabelle sich
// nicht neu zeichnen – sie würde das Eingabefeld unter den Fingern wegreißen.
export function istBearbeitungOffen() {
  return aktiv !== null || laufendeSpeicher > 0;
}

export function beiBearbeitungEnde(callback) {
  endeCallbacks.push(callback);
}

function meldeEnde() {
  if (istBearbeitungOffen()) return;
  endeCallbacks.forEach((callback) => callback());
}

// ---------------------------------------------------------------------
// Fehler an der Zelle
// ---------------------------------------------------------------------

function zelleSchluessel(config, td) {
  return config.schluesselAttribut === "id" ? td.dataset.id : td.dataset.name;
}

function fehlerSchluessel(config, schluessel, feld) {
  return `${config.tabellenId}|${schluessel}|${feld}`;
}

function markiereFehler(td, meldung) {
  td.classList.add("catalog-cell-error");
  td.title = meldung;
}

function findeZelle(config, schluessel, feld) {
  const zellen = config.tabelle?.querySelectorAll(`td[data-field="${CSS.escape(feld)}"]`) ?? [];
  return [...zellen].find((td) => zelleSchluessel(config, td) === schluessel) ?? null;
}

function loescheFehler(config, schluessel, feld) {
  fehler.delete(fehlerSchluessel(config, schluessel, feld));
}

// Nach jedem Rendern aufrufen: gespeicherte Fehler wieder sichtbar machen.
export function zeichneFehlerNeu(tabelle) {
  const config = tabellen.get(tabelle);
  if (!config) return;
  fehler.forEach((eintrag, key) => {
    if (!key.startsWith(`${config.tabellenId}|`)) return;
    const td = findeZelle(config, eintrag.schluessel, eintrag.feld);
    if (!td) return;
    setzeZellInhalt(td, eintrag.anzeige);
    markiereFehler(td, eintrag.meldung);
  });
}

// ---------------------------------------------------------------------
// Werte lesen und vergleichen
// ---------------------------------------------------------------------

function eingabeWert(spalte, eintrag) {
  const wert = eintrag[spalte.field];
  if (spalte.type === "bool") return wert ? "1" : "";
  if (spalte.type === "tags") return (wert ?? []).join(", ");
  return wert == null ? "" : String(wert);
}

// Wirft bei ungültiger Eingabe – die Meldung landet direkt an der Zelle.
function leseEingabe(spalte, el) {
  if (spalte.type === "bool") return el.value === "1";
  if (spalte.type === "select") {
    const option = (spalte.options?.() ?? []).find((o) => String(o.value) === el.value);
    return option ? option.value : el.value;
  }
  const roh = el.value.trim();
  if (spalte.type === "number") {
    // Hinterm Tresen wird mit Komma getippt; das darf die Zahl nicht kippen.
    if (roh === "") return "";
    const zahl = Number(roh.replace(",", "."));
    if (!Number.isFinite(zahl)) throw new Error(t("ui.bitte_eine_zahl_eingeben"));
    return zahl;
  }
  if (spalte.type === "tags") {
    return roh ? roh.split(",").map((s) => s.trim()).filter(Boolean) : [];
  }
  return roh;
}

function gleich(spalte, alt, neu) {
  if (spalte.type === "tags") return (alt ?? []).join("\n") === (neu ?? []).join("\n");
  if (spalte.type === "bool") return Boolean(alt) === Boolean(neu);
  if (spalte.type === "number") {
    const a = alt === "" || alt == null ? "" : Number(alt);
    const b = neu === "" || neu == null ? "" : Number(neu);
    return a === b;
  }
  return String(alt ?? "") === String(neu ?? "");
}

// ---------------------------------------------------------------------
// Eingabeelement
// ---------------------------------------------------------------------

function fuelleVorschlaege(werte) {
  if (!vorschlagListe) {
    vorschlagListe = document.createElement("datalist");
    vorschlagListe.id = "tableedit-vorschlaege";
    document.body.appendChild(vorschlagListe);
  }
  vorschlagListe.textContent = "";
  werte.forEach((wert) => {
    const option = document.createElement("option");
    option.value = wert;
    vorschlagListe.appendChild(option);
  });
  return vorschlagListe.id;
}

function baueEingabe(spalte, eintrag, config) {
  if (spalte.type === "bool" || spalte.type === "select") {
    const select = document.createElement("select");
    select.className = "catalog-cell-input";
    const optionen =
      spalte.type === "bool"
        ? [
            { value: "", label: t("ui.nein") },
            { value: "1", label: t("ui.ja") },
          ]
        : [{ value: "", label: t("ui.ohne_angabe") }, ...(spalte.options?.() ?? [])];
    optionen.forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = label;
      select.appendChild(option);
    });
    select.value = eingabeWert(spalte, eintrag);
    return select;
  }

  if (spalte.type === "longtext") {
    const textarea = document.createElement("textarea");
    textarea.className = "catalog-cell-input catalog-cell-input-long";
    textarea.rows = 4;
    textarea.value = eingabeWert(spalte, eintrag);
    return textarea;
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "catalog-cell-input";
  input.autocomplete = "off";
  if (spalte.type === "number") input.inputMode = "decimal";
  input.value = eingabeWert(spalte, eintrag);
  if (spalte.suggest) {
    const werte = config.vorschlaege?.(spalte) ?? [];
    if (werte.length) input.setAttribute("list", fuelleVorschlaege(werte));
  }
  return input;
}

// ---------------------------------------------------------------------
// Öffnen, Übernehmen, Abbrechen
// ---------------------------------------------------------------------

function nachbarZelle(td, richtung) {
  const zellen = [...(td.parentElement?.children ?? [])];
  for (let i = zellen.indexOf(td) + richtung; i >= 0 && i < zellen.length; i += richtung) {
    if (zellen[i].classList.contains("catalog-cell-editable")) return zellen[i];
  }
  return null;
}

function zeigeEingabeFehler(meldung) {
  if (!aktiv) return;
  markiereFehler(aktiv.td, meldung);
  aktiv.eingabe.focus();
}

function abbrechen() {
  if (!aktiv) return;
  const { td, config, eintrag, spalte } = aktiv;
  aktiv = null;
  td.classList.remove("catalog-cell-open", "catalog-cell-error");
  loescheFehler(config, zelleSchluessel(config, td), spalte.field);
  setzeZellInhalt(td, config.text(eintrag, spalte));
  meldeEnde();
}

// `danach` läuft, sobald die Zelle zu ist – noch bevor gespeichert wurde.
// Nur so fühlt sich Tab durch eine Zeile flüssig an.
function uebernehmen(danach) {
  if (!aktiv) return;
  const { td, eingabe, spalte, eintrag, config } = aktiv;
  const schluessel = zelleSchluessel(config, td);

  let wert;
  try {
    wert = leseEingabe(spalte, eingabe);
  } catch (err) {
    // Eingabefeld offen lassen: der getippte Wert soll nicht verloren gehen.
    zeigeEingabeFehler(err.message);
    return;
  }

  aktiv = null;
  td.classList.remove("catalog-cell-open", "catalog-cell-error");
  loescheFehler(config, schluessel, spalte.field);

  if (gleich(spalte, eintrag[spalte.field], wert)) {
    setzeZellInhalt(td, config.text(eintrag, spalte));
    if (danach) danach();
    meldeEnde();
    return;
  }

  const neuerEintrag = { ...eintrag, [spalte.field]: wert };
  const anzeige = config.text(neuerEintrag, spalte);
  setzeZellInhalt(td, anzeige);
  td.classList.add("catalog-cell-saving");

  if (danach) danach();

  laufendeSpeicher += 1;
  speicherKette = speicherKette
    .then(() => config.speichern(schluessel, spalte, wert))
    .then(() => {
      td.classList.remove("catalog-cell-saving");
    })
    .catch((err) => {
      const meldung = `${t("ui.nicht_gespeichert")}: ${err?.message ?? err}`;
      fehler.set(fehlerSchluessel(config, schluessel, spalte.field), {
        schluessel,
        feld: spalte.field,
        meldung,
        anzeige,
      });
      // Die Tabelle kann zwischenzeitlich neu gezeichnet worden sein – dann
      // ist td nicht mehr die Zelle, die gerade auf dem Schirm steht.
      const ziel = findeZelle(config, schluessel, spalte.field) ?? td;
      ziel.classList.remove("catalog-cell-saving");
      setzeZellInhalt(ziel, anzeige);
      markiereFehler(ziel, meldung);
    })
    .finally(() => {
      laufendeSpeicher -= 1;
      meldeEnde();
    });
}

function oeffne(td, config) {
  if (aktiv?.td === td) return;
  if (aktiv) uebernehmen();
  if (aktiv) return; // Übernehmen hat wegen einer ungültigen Eingabe abgelehnt.

  const spalte = config.spalte(td.dataset.field);
  if (!istSpalteEditierbar(spalte)) return;
  const eintrag = config.eintrag(zelleSchluessel(config, td));
  if (!eintrag) return;

  const eingabe = baueEingabe(spalte, eintrag, config);
  td.textContent = "";
  td.removeAttribute("title");
  td.classList.add("catalog-cell-open");
  td.appendChild(eingabe);
  aktiv = { td, eingabe, spalte, eintrag, config };

  eingabe.focus();
  if (typeof eingabe.select === "function") eingabe.select();

  eingabe.addEventListener("blur", () => {
    if (aktiv?.eingabe === eingabe) uebernehmen();
  });

  if (eingabe.tagName === "SELECT") {
    eingabe.addEventListener("change", () => {
      if (aktiv?.eingabe === eingabe) uebernehmen();
    });
  }

  eingabe.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      abbrechen();
      return;
    }
    if (event.key === "Enter") {
      // Im mehrzeiligen Feld ist Enter ein Zeilenumbruch; gespeichert wird
      // dort mit Strg/Cmd+Enter oder beim Verlassen.
      if (eingabe.tagName === "TEXTAREA" && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      uebernehmen();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const ziel = nachbarZelle(td, event.shiftKey ? -1 : 1);
      uebernehmen(() => {
        if (ziel) oeffne(ziel, config);
      });
    }
  });
}

// ---------------------------------------------------------------------
// Einhängen
// ---------------------------------------------------------------------

// config:
//   tabellenId          – eindeutiger Name für den Fehlerspeicher
//   schluesselAttribut  – "name" (Katalog) oder "id" (Fragen)
//   spalte(feld)        – Spaltendefinition zum Feld
//   eintrag(schluessel) – aktueller Datensatz aus Bibliothek bzw. Cache
//   text(eintrag, spalte) – Anzeigetext der Zelle
//   darfSchreiben()     – Schreibrecht vorhanden und online
//   sperrhinweis()      – zeigt, warum gerade nicht geschrieben werden kann
//   vorschlaege(spalte) – Werte für die Vorschlagsliste
//   speichern(schluessel, spalte, wert) – schreibt über js/storage.js; holt
//     sich den Eintrag selbst, damit er beim Schreiben aktuell ist
export function initCellEditing(tabelle, config) {
  if (!tabelle) return;
  const vollstaendig = { ...config, tabelle };
  tabellen.set(tabelle, vollstaendig);

  tabelle.addEventListener("click", (event) => {
    const td = event.target.closest("td");
    if (!td || !tabelle.contains(td)) return;
    if (!td.classList.contains("catalog-cell-editable")) return;
    if (aktiv?.td === td) return;
    if (!vollstaendig.darfSchreiben()) {
      vollstaendig.sperrhinweis?.();
      return;
    }
    oeffne(td, vollstaendig);
  });
}
