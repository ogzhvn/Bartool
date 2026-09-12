// Bereichs- und Zwischenablage-Ebene der Katalogtabelle (js/adminTable.js).
//
// Hier steht nur reine Rechnerei: ein Rechteck aus zwei Eckpunkten, TSV lesen
// und schreiben, Text ersetzen. Keine DOM-Kenntnis, kein Puffer – damit die
// Tabelle sich um Fokus, Auswahl und Speichern kümmern kann und diese Stellen
// einzeln nachvollziehbar bleiben.
//
// TSV ist das Format, in dem Excel, Numbers und LibreOffice einen kopierten
// Zellbereich in die Zwischenablage legen: Spalten mit Tab getrennt, Zeilen
// mit Zeilenumbruch. Felder, die selbst Tab, Umbruch oder Anführungszeichen
// enthalten, stehen in doppelten Anführungszeichen, ein enthaltenes
// Anführungszeichen wird verdoppelt.

// Rechteck aus zwei Eckpunkten { zeile, spalte } – egal, in welcher
// Reihenfolge sie aufgespannt wurden.
export function rechteck(a, b) {
  return {
    z1: Math.min(a.zeile, b.zeile),
    z2: Math.max(a.zeile, b.zeile),
    s1: Math.min(a.spalte, b.spalte),
    s2: Math.max(a.spalte, b.spalte),
  };
}

export function imRechteck(bereich, zeile, spalte) {
  return zeile >= bereich.z1 && zeile <= bereich.z2 && spalte >= bereich.s1 && spalte <= bereich.s2;
}

export function parseTsv(text) {
  // Zeilenenden vereinheitlichen: Excel unter Windows liefert \r\n, ältere
  // Mac-Programme \r.
  const roh = String(text ?? "").replace(/\r\n?/g, "\n");
  const zeilen = [];
  let zeile = [];
  let feld = "";
  let inAnfuehrung = false;

  for (let i = 0; i < roh.length; i += 1) {
    const zeichen = roh[i];

    if (inAnfuehrung) {
      if (zeichen !== '"') {
        feld += zeichen;
      } else if (roh[i + 1] === '"') {
        feld += '"';
        i += 1;
      } else {
        inAnfuehrung = false;
      }
      continue;
    }

    // Ein Anführungszeichen eröffnet nur am Feldanfang ein Zitat – mitten im
    // Text ist es ein Zoll-Zeichen ("0,7 l" oder 5" Rührglas).
    if (zeichen === '"' && feld === "") {
      inAnfuehrung = true;
    } else if (zeichen === "\t") {
      zeile.push(feld);
      feld = "";
    } else if (zeichen === "\n") {
      zeile.push(feld);
      zeilen.push(zeile);
      zeile = [];
      feld = "";
    } else {
      feld += zeichen;
    }
  }

  zeile.push(feld);
  zeilen.push(zeile);

  // Der Zeilenumbruch am Ende einer kopierten Auswahl erzeugt eine leere
  // Schlusszeile – die ist keine Zeile, sondern ein Trennzeichen.
  const letzte = zeilen[zeilen.length - 1];
  if (zeilen.length > 1 && letzte.length === 1 && letzte[0] === "") zeilen.pop();

  return zeilen;
}

function feldZuTsv(wert) {
  const text = String(wert ?? "");
  return /[\t\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toTsv(zeilen) {
  return zeilen.map((zeile) => zeile.map(feldZuTsv).join("\t")).join("\n");
}

// Ersetzt jedes Vorkommen, ohne Umweg über einen regulären Ausdruck: der
// Suchbegriff kommt aus einem Eingabefeld und darf Punkte, Klammern und
// Sternchen enthalten, ohne dass sie als Muster gelten.
export function ersetzeAlle(text, suche, ersatz, { beachteGrossKlein = false } = {}) {
  const quelle = String(text ?? "");
  const nadel = String(suche ?? "");
  if (nadel === "") return { text: quelle, treffer: 0 };

  const heuhaufen = beachteGrossKlein ? quelle : quelle.toLowerCase();
  const gesucht = beachteGrossKlein ? nadel : nadel.toLowerCase();
  let ergebnis = "";
  let treffer = 0;
  let pos = 0;

  for (;;) {
    const index = heuhaufen.indexOf(gesucht, pos);
    if (index === -1) break;
    ergebnis += quelle.slice(pos, index) + String(ersatz ?? "");
    pos = index + gesucht.length;
    treffer += 1;
  }

  return { text: ergebnis + quelle.slice(pos), treffer };
}
