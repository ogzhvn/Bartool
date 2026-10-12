// Große Offline-Puffer in IndexedDB statt im localStorage.
//
// Der localStorage fasst in Safari nur etwa 5 MB, und allein der
// Fragenkatalog belegte dort rund zwei Drittel davon (siehe js/localSpace.js).
// IndexedDB ist für solche Mengen gedacht und hat ein Vielfaches an Platz.
// Gespeichert wird der Wert direkt (structured clone), ohne JSON-Umweg.
//
// Alles hier ist Komfort: Klappt IndexedDB nicht (gesperrt, privater Modus
// alter Browser, Fehler), liefern die Funktionen null bzw. false, und die App
// lädt eben aus dem Netz.

const DB_NAME = "bartool";
const DB_VERSION = 1;
const STORE = "puffer";

let dbPromise = null;

function oeffne() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const anfrage = indexedDB.open(DB_NAME, DB_VERSION);
      anfrage.onupgradeneeded = () => {
        if (!anfrage.result.objectStoreNames.contains(STORE)) anfrage.result.createObjectStore(STORE);
      };
      anfrage.onsuccess = () => resolve(anfrage.result);
      anfrage.onerror = () => resolve(null);
      anfrage.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function vorgang(modus, arbeit) {
  return oeffne().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction(STORE, modus);
          const anfrage = arbeit(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(anfrage?.result ?? true);
          tx.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

export async function idbLesen(key) {
  const wert = await vorgang("readonly", (store) => store.get(key));
  return wert === true ? null : (wert ?? null);
}

export async function idbSchreiben(key, wert) {
  return (await vorgang("readwrite", (store) => store.put(wert, key))) !== null;
}
