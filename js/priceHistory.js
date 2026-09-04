import { getSupabaseClient } from "./supabaseClient.js";
import { getCurrentUser } from "./auth.js";

// Einkaufspreis-Historie.
//
// Früher wurde ein geänderter Einkaufspreis am Produkt einfach überschrieben:
// der alte Wert war weg, und niemand konnte sehen, wann und um wie viel ein
// Lieferant teurer geworden ist. Jede Preisänderung landet deshalb zusätzlich
// als eigene Zeile in der Tabelle "product_prices".
//
// Geschrieben wird ausschließlich aus saveProduct() heraus (js/storage.js) –
// es gibt bewusst keinen zweiten Schreibweg im UI, sonst driften Produkt und
// Historie auseinander.

const PRICES_UPDATED_EVENT = "bartool:product-prices-updated";
const PRICES_CACHE_KEY = "bartool:product-prices";

let pricesCache = [];
let pricesChannel = null;

function readCache() {
  try {
    const raw = localStorage.getItem(PRICES_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(data) {
  try {
    localStorage.setItem(PRICES_CACHE_KEY, JSON.stringify(data));
  } catch {
    // Kein Platz oder kein Zugriff: der Puffer ist Komfort, kein Muss.
  }
}

function fromPriceRow(row) {
  return {
    id: row.id,
    productName: row.product_name,
    priceValue: row.price_value == null ? null : Number(row.price_value),
    priceUnit: row.price_unit ?? "liter",
    validFrom: row.valid_from ?? "",
    source: row.source ?? "",
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? "",
  };
}

// Leerer Preis und 0 bedeuten im Tool dasselbe: "kein Einkaufspreis
// hinterlegt". Ohne diese Normalisierung würde ein leer gelassenes Feld
// (products.js schreibt dann 0) als Preissturz auf 0 € in der Historie landen.
function normalizePrice(value) {
  if (value === "" || value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return null;
  return num;
}

async function refreshPrices() {
  const supabase = getSupabaseClient();
  let data = null;
  let error = null;
  try {
    ({ data, error } = await supabase
      .from("product_prices")
      .select("*")
      .order("valid_from", { ascending: false })
      .order("created_at", { ascending: false }));
  } catch (err) {
    error = err;
  }
  if (!error) {
    pricesCache = (data ?? []).map(fromPriceRow);
    writeCache(pricesCache);
  } else {
    const buffered = readCache();
    if (buffered) pricesCache = buffered;
  }
  window.dispatchEvent(new CustomEvent(PRICES_UPDATED_EVENT));
}

export async function initPriceHistorySync() {
  const buffered = readCache();
  if (buffered) {
    pricesCache = buffered;
    window.dispatchEvent(new CustomEvent(PRICES_UPDATED_EVENT));
  }
  await refreshPrices();
  const supabase = getSupabaseClient();
  if (pricesChannel) supabase.removeChannel(pricesChannel);
  pricesChannel = supabase
    .channel("public:product_prices")
    .on("postgres_changes", { event: "*", schema: "public", table: "product_prices" }, refreshPrices)
    .subscribe();
}

export function onPricesChanged(callback) {
  window.addEventListener(PRICES_UPDATED_EVENT, callback);
}

// Alle Preisstände eines Produkts, neuester zuerst. Sortiert wird zusätzlich
// in JS: Startbestand und eine Änderung am selben Tag haben dasselbe
// Gültigkeitsdatum, dann entscheidet der Zeitstempel.
export function priceHistoryFor(productName) {
  if (!productName) return [];
  return pricesCache
    .filter((entry) => entry.productName === productName)
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom) || b.createdAt.localeCompare(a.createdAt));
}

// Der Preisstand vor dem aktuellen – Vergleichswert für die Warnung
// "Wareneinsatz gestiegen". Ohne Vorgänger (Produkt nur einmal gepflegt)
// gibt es nichts zu vergleichen.
export function previousPriceFor(productName) {
  const entries = priceHistoryFor(productName);
  if (entries.length < 2) return null;
  const previous = entries[1];
  if (previous.priceValue == null || previous.priceValue === 0) return null;
  return previous;
}

// Schreibt einen neuen Preisstand, wenn sich der Einkaufspreis gegenüber dem
// zuletzt gespeicherten Produktstand geändert hat. Rückgabe: true, wenn eine
// Zeile geschrieben wurde.
//
// Ein Fehler beim Schreiben der Historie darf das Speichern des Produkts
// nicht kippen – die Historie ist Nachweis, nicht Voraussetzung.
export async function recordPriceChange(product, previousProduct, source = "Produktpflege") {
  const neuerPreis = normalizePrice(product?.priceValue);
  const alterPreis = normalizePrice(previousProduct?.priceValue);
  const neueEinheit = product?.priceUnit || "liter";
  const alteEinheit = previousProduct?.priceUnit || "liter";

  if (neuerPreis === null) return false;
  if (previousProduct && neuerPreis === alterPreis && neueEinheit === alteEinheit) return false;

  const supabase = getSupabaseClient();
  const user = getCurrentUser();
  try {
    const { error } = await supabase.from("product_prices").insert({
      product_name: product.name,
      price_value: neuerPreis,
      price_unit: neueEinheit,
      source,
      created_by: user?.id ?? null,
    });
    if (error) throw error;
  } catch (err) {
    console.warn("Preisverlauf konnte nicht geschrieben werden:", err?.message ?? err);
    return false;
  }
  await refreshPrices();
  return true;
}
