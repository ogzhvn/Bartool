import { getSupabaseClient } from "./supabaseClient.js";

const RECIPES_UPDATED_EVENT = "bartool:recipes-updated";
const PRODUCTS_UPDATED_EVENT = "bartool:products-updated";
const PREPARATIONS_UPDATED_EVENT = "bartool:preparations-updated";

let recipesCache = [];
let productsCache = [];
let preparationsCache = [];
let recipesChannel = null;
let productsChannel = null;
let preparationsChannel = null;

// ---------------------------------------------------------------------
// Offline-Puffer
//
// Der Tresen hat nicht überall Empfang. Rezepte und Produkte werden daher
// zusätzlich in localStorage gespiegelt: beim Start wird zuerst der Puffer
// gerendert, das Netz aktualisiert danach. Alle Zugriffe sind bewusst in
// try/catch – ein volles oder gesperrtes localStorage (privater Modus,
// Speicherlimit) darf die App nie kippen.
// ---------------------------------------------------------------------

const RECIPES_CACHE_KEY = "bartool:recipes";
const PRODUCTS_CACHE_KEY = "bartool:products";
const PREPARATIONS_CACHE_KEY = "bartool:preparations";

function readCache(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCache(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Kein Platz oder kein Zugriff: der Puffer ist Komfort, kein Muss.
  }
}

export function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function offlineWriteError() {
  return new Error("Offline – Änderungen sind erst wieder mit Netzverbindung möglich.");
}

// ---------------------------------------------------------------------
// Rezepte (Tabelle "recipes" in Supabase)
// ---------------------------------------------------------------------

function toRecipeRecord(recipe) {
  return {
    name: recipe.name,
    category: recipe.category || null,
    base_portions: recipe.basePortions,
    ingredients: recipe.ingredients,
    method: recipe.method || null,
    glass: recipe.glass || null,
    garnish: recipe.garnish || null,
    ice: recipe.ice || null,
    history: recipe.history || null,
    quick_pitch: recipe.quickPitch || null,
    pairs_with: recipe.pairsWith ?? null,
    sales_price:
      recipe.salesPrice === "" || recipe.salesPrice == null ? null : Number(recipe.salesPrice),
  };
}

function fromRecipeRow(row) {
  return {
    name: row.name,
    category: row.category ?? "",
    basePortions: row.base_portions,
    ingredients: row.ingredients ?? [],
    method: row.method ?? "",
    glass: row.glass ?? "",
    garnish: row.garnish ?? "",
    ice: row.ice ?? "",
    history: row.history ?? "",
    quickPitch: row.quick_pitch ?? "",
    pairsWith: row.pairs_with ?? [],
    salesPrice: row.sales_price ?? "",
  };
}

async function refreshRecipes() {
  const supabase = getSupabaseClient();
  let data = null;
  let error = null;
  try {
    ({ data, error } = await supabase.from("recipes").select("*").order("name"));
  } catch (err) {
    // Offline wirft der Fetch, statt nur `error` zu setzen.
    error = err;
  }
  if (!error) {
    recipesCache = (data ?? []).map(fromRecipeRow);
    writeCache(RECIPES_CACHE_KEY, recipesCache);
  } else {
    // Netz weg: lieber den letzten bekannten Stand zeigen als eine leere Liste.
    const buffered = readCache(RECIPES_CACHE_KEY);
    if (buffered) recipesCache = buffered;
  }
  window.dispatchEvent(new CustomEvent(RECIPES_UPDATED_EVENT));
}

// Einmal beim App-Start (nach dem Login) aufrufen: lädt den Cache initial
// und hält ihn per Realtime synchron, damit Änderungen von anderen
// Geräten/Nutzern automatisch ankommen.
export async function initRecipeSync() {
  // Erst den Offline-Puffer anzeigen, damit die App sofort etwas rendert,
  // dann erst das Netz abwarten.
  const buffered = readCache(RECIPES_CACHE_KEY);
  if (buffered) {
    recipesCache = buffered;
    window.dispatchEvent(new CustomEvent(RECIPES_UPDATED_EVENT));
  }
  await refreshRecipes();
  const supabase = getSupabaseClient();
  if (recipesChannel) supabase.removeChannel(recipesChannel);
  recipesChannel = supabase
    .channel("public:recipes")
    .on("postgres_changes", { event: "*", schema: "public", table: "recipes" }, refreshRecipes)
    .subscribe();
}

export function loadRecipes() {
  return recipesCache;
}

export async function saveRecipe(recipe) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("recipes").upsert(toRecipeRecord(recipe), { onConflict: "name" });
  if (error) throw error;
  await refreshRecipes();
}

export async function deleteRecipe(name) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("recipes").delete().eq("name", name);
  if (error) throw error;
  await refreshRecipes();
}

export function onRecipesChanged(callback) {
  window.addEventListener(RECIPES_UPDATED_EVENT, callback);
}

// ---------------------------------------------------------------------
// Produkte (Tabelle "products" in Supabase)
// ---------------------------------------------------------------------

function toProductRecord(product) {
  return {
    name: product.name,
    category: product.category || null,
    group_name: product.group || null,
    sub_group: product.subGroup || null,
    abv: product.abv || null,
    tasting_notes: product.tastingNotes || null,
    service: product.service || null,
    alternatives: product.alternatives || null,
    story: product.story || null,
    production: product.production || null,
    allergens: product.allergens || null,
    price_value: product.priceValue === "" || product.priceValue == null ? null : Number(product.priceValue),
    price_unit: product.priceUnit || null,
    quick_pitch: product.quickPitch || null,
    pairs_with: product.pairsWith ?? null,
    region: product.region || null,
    grape_variety: product.grapeVariety || null,
    vineyard: product.vineyard || null,
    vintage: product.vintage || null,
    aging: product.aging || null,
    food_pairing: product.foodPairing || null,
    drinking_window: product.drinkingWindow || null,
    par_level: product.parLevel === "" || product.parLevel == null ? null : Number(product.parLevel),
    supplier: product.supplier || null,
    order_unit: product.orderUnit || null,
  };
}

function fromProductRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category ?? "",
    group: row.group_name ?? "",
    subGroup: row.sub_group ?? "",
    abv: row.abv ?? "",
    tastingNotes: row.tasting_notes ?? "",
    service: row.service ?? "",
    alternatives: row.alternatives ?? "",
    story: row.story ?? "",
    production: row.production ?? "",
    allergens: row.allergens ?? "",
    priceValue: row.price_value ?? "",
    priceUnit: row.price_unit ?? "liter",
    quickPitch: row.quick_pitch ?? "",
    pairsWith: row.pairs_with ?? [],
    region: row.region ?? "",
    grapeVariety: row.grape_variety ?? "",
    vineyard: row.vineyard ?? "",
    vintage: row.vintage ?? "",
    aging: row.aging ?? "",
    foodPairing: row.food_pairing ?? "",
    drinkingWindow: row.drinking_window ?? "",
    parLevel: row.par_level ?? "",
    supplier: row.supplier ?? "",
    orderUnit: row.order_unit ?? "",
  };
}

async function refreshProducts() {
  const supabase = getSupabaseClient();
  let data = null;
  let error = null;
  try {
    ({ data, error } = await supabase.from("products").select("*").order("name"));
  } catch (err) {
    error = err;
  }
  if (!error) {
    productsCache = (data ?? []).map(fromProductRow);
    writeCache(PRODUCTS_CACHE_KEY, productsCache);
  } else {
    const buffered = readCache(PRODUCTS_CACHE_KEY);
    if (buffered) productsCache = buffered;
  }
  window.dispatchEvent(new CustomEvent(PRODUCTS_UPDATED_EVENT));
}

export async function initProductSync() {
  const buffered = readCache(PRODUCTS_CACHE_KEY);
  if (buffered) {
    productsCache = buffered;
    window.dispatchEvent(new CustomEvent(PRODUCTS_UPDATED_EVENT));
  }
  await refreshProducts();
  const supabase = getSupabaseClient();
  if (productsChannel) supabase.removeChannel(productsChannel);
  productsChannel = supabase
    .channel("public:products")
    .on("postgres_changes", { event: "*", schema: "public", table: "products" }, refreshProducts)
    .subscribe();
}

export function loadProducts() {
  return productsCache;
}

export async function saveProduct(product) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("products").upsert(toProductRecord(product), { onConflict: "name" });
  if (error) throw error;
  await refreshProducts();
}

export async function deleteProduct(name) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("products").delete().eq("name", name);
  if (error) throw error;
  await refreshProducts();
}

export function onProductsChanged(callback) {
  window.addEventListener(PRODUCTS_UPDATED_EVENT, callback);
}

// ---------------------------------------------------------------------
// Ansätze / Mise en Place (Tabelle "preparations" in Supabase)
//
// Gleiches Muster wie Rezepte und Produkte. Unterschied: hier ist der
// Schlüssel die id, nicht der Name – denselben Ansatz kann es mehrfach
// geben (jede Charge ist ein eigener Eintrag).
// ---------------------------------------------------------------------

function toPreparationRecord(prep) {
  const record = {
    label: prep.label,
    recipe_name: prep.recipeName || null,
    prep_type: prep.prepType || "sonstiges",
    batch_size_ml: prep.batchSizeMl === "" || prep.batchSizeMl == null ? null : Number(prep.batchSizeMl),
    abv: prep.abv === "" || prep.abv == null ? null : Number(prep.abv),
    location: prep.location || null,
    made_at: prep.madeAt || new Date().toISOString(),
    expires_at: prep.expiresAt || null,
    status: prep.status || "aktiv",
    notes: prep.notes || null,
  };
  if (prep.id) record.id = prep.id;
  if (prep.madeBy) record.made_by = prep.madeBy;
  return record;
}

function fromPreparationRow(row) {
  return {
    id: row.id,
    label: row.label,
    recipeName: row.recipe_name ?? "",
    prepType: row.prep_type ?? "sonstiges",
    batchSizeMl: row.batch_size_ml ?? "",
    abv: row.abv ?? "",
    location: row.location ?? "",
    madeAt: row.made_at,
    madeBy: row.made_by ?? null,
    expiresAt: row.expires_at ?? null,
    status: row.status ?? "aktiv",
    notes: row.notes ?? "",
  };
}

async function refreshPreparations() {
  const supabase = getSupabaseClient();
  let data = null;
  let error = null;
  try {
    ({ data, error } = await supabase.from("preparations").select("*").order("expires_at", { nullsFirst: false }));
  } catch (err) {
    error = err;
  }
  if (!error) {
    preparationsCache = (data ?? []).map(fromPreparationRow);
    writeCache(PREPARATIONS_CACHE_KEY, preparationsCache);
  } else {
    const buffered = readCache(PREPARATIONS_CACHE_KEY);
    if (buffered) preparationsCache = buffered;
  }
  window.dispatchEvent(new CustomEvent(PREPARATIONS_UPDATED_EVENT));
}

export async function initPreparationSync() {
  const buffered = readCache(PREPARATIONS_CACHE_KEY);
  if (buffered) {
    preparationsCache = buffered;
    window.dispatchEvent(new CustomEvent(PREPARATIONS_UPDATED_EVENT));
  }
  await refreshPreparations();
  const supabase = getSupabaseClient();
  if (preparationsChannel) supabase.removeChannel(preparationsChannel);
  preparationsChannel = supabase
    .channel("public:preparations")
    .on("postgres_changes", { event: "*", schema: "public", table: "preparations" }, refreshPreparations)
    .subscribe();
}

export function loadPreparations() {
  return preparationsCache;
}

export async function savePreparation(prep) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("preparations").upsert(toPreparationRecord(prep));
  if (error) throw error;
  await refreshPreparations();
}

export async function deletePreparation(id) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("preparations").delete().eq("id", id);
  if (error) throw error;
  await refreshPreparations();
}

export function onPreparationsChanged(callback) {
  window.addEventListener(PREPARATIONS_UPDATED_EVENT, callback);
}

// ---------------------------------------------------------------------
// Inventur (Tabellen "inventory_counts" und "inventory_items")
//
// Anders als bei Rezepten und Produkten wird hier nicht alles in einen
// Cache geladen: eine Zählung hat schnell dreihundert Positionen, und
// gezählt wird immer nur in einer. Der Kopf-Datensatz kommt in den Cache,
// die Positionen werden je Zählung geladen.
// ---------------------------------------------------------------------

const COUNTS_UPDATED_EVENT = "bartool:inventory-counts-updated";
const COUNTS_CACHE_KEY = "bartool:inventory-counts";

let countsCache = [];
let countsChannel = null;

function fromCountRow(row) {
  return {
    id: row.id,
    countedOn: row.counted_on,
    title: row.title ?? "",
    status: row.status ?? "offen",
    createdBy: row.created_by ?? null,
    note: row.note ?? "",
    createdAt: row.created_at,
  };
}

async function refreshInventoryCounts() {
  const supabase = getSupabaseClient();
  let data = null;
  let error = null;
  try {
    ({ data, error } = await supabase
      .from("inventory_counts")
      .select("*")
      .order("counted_on", { ascending: false }));
  } catch (err) {
    error = err;
  }
  if (!error) {
    countsCache = (data ?? []).map(fromCountRow);
    writeCache(COUNTS_CACHE_KEY, countsCache);
  } else {
    const buffered = readCache(COUNTS_CACHE_KEY);
    if (buffered) countsCache = buffered;
  }
  window.dispatchEvent(new CustomEvent(COUNTS_UPDATED_EVENT));
}

export async function initInventorySync() {
  const buffered = readCache(COUNTS_CACHE_KEY);
  if (buffered) {
    countsCache = buffered;
    window.dispatchEvent(new CustomEvent(COUNTS_UPDATED_EVENT));
  }
  await refreshInventoryCounts();
  const supabase = getSupabaseClient();
  if (countsChannel) supabase.removeChannel(countsChannel);
  countsChannel = supabase
    .channel("public:inventory_counts")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "inventory_counts" },
      refreshInventoryCounts
    )
    .subscribe();
}

export function loadInventoryCounts() {
  return countsCache;
}

export function onInventoryCountsChanged(callback) {
  window.addEventListener(COUNTS_UPDATED_EVENT, callback);
}

export async function saveInventoryCount(count) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const record = {
    counted_on: count.countedOn,
    title: count.title || null,
    status: count.status || "offen",
    note: count.note || null,
  };
  if (count.id) record.id = count.id;
  if (count.createdBy) record.created_by = count.createdBy;
  const { data, error } = await supabase.from("inventory_counts").upsert(record).select().single();
  if (error) throw error;
  await refreshInventoryCounts();
  return fromCountRow(data);
}

export async function deleteInventoryCount(id) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("inventory_counts").delete().eq("id", id);
  if (error) throw error;
  await refreshInventoryCounts();
}

// Positionen einer Zählung. Rückgabe als Objekt {produktname: {quantity, unit}},
// weil die Zählansicht genau so darauf zugreift.
export async function loadInventoryItems(countId) {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("count_id", countId);
  if (error) throw error;
  const map = {};
  (data ?? []).forEach((row) => {
    map[row.product_name] = { quantity: row.quantity, unit: row.unit ?? "" };
  });
  return map;
}

// Schreibt mehrere Positionen auf einmal. Wird vom Zähl-Modus benutzt, um
// den lokal gepufferten Zwischenstand gebündelt hochzuladen.
export async function saveInventoryItems(countId, eintraege) {
  if (isOffline()) throw offlineWriteError();
  if (!eintraege.length) return;
  const supabase = getSupabaseClient();
  const rows = eintraege.map((e) => ({
    count_id: countId,
    product_name: e.productName,
    quantity: e.quantity === "" || e.quantity == null ? null : Number(e.quantity),
    unit: e.unit || null,
  }));
  const { error } = await supabase
    .from("inventory_items")
    .upsert(rows, { onConflict: "count_id,product_name" });
  if (error) throw error;
}
