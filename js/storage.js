import { getSupabaseClient } from "./supabaseClient.js";
import { recordPriceChange } from "./priceHistory.js";
import { t } from "./i18n.js";

const RECIPES_UPDATED_EVENT = "bartool:recipes-updated";
const PRODUCTS_UPDATED_EVENT = "bartool:products-updated";
const PREPARATIONS_UPDATED_EVENT = "bartool:preparations-updated";
const EVENTS_UPDATED_EVENT = "bartool:events-updated";
const SHIFT_LOGS_UPDATED_EVENT = "bartool:shift-logs-updated";
const LOSSES_UPDATED_EVENT = "bartool:losses-updated";
const CHECKLIST_TEMPLATES_UPDATED_EVENT = "bartool:checklist-templates-updated";
const CHECKLIST_RUNS_UPDATED_EVENT = "bartool:checklist-runs-updated";
const QUIZ_QUESTIONS_UPDATED_EVENT = "bartool:quiz-questions-updated";
const KNOWLEDGE_UPDATED_EVENT = "bartool:knowledge-updated";

let recipesCache = [];
let productsCache = [];
let preparationsCache = [];
let eventsCache = [];
let shiftLogsCache = [];
let lossesCache = [];
let checklistTemplatesCache = [];
let checklistRunsCache = [];
let quizQuestionsCache = [];
let knowledgeCache = [];
let knowledgeReadsCache = new Map();
let recipesChannel = null;
let productsChannel = null;
let preparationsChannel = null;
let eventsChannel = null;
let shiftLogsChannel = null;
let lossesChannel = null;
let checklistTemplatesChannel = null;
let checklistRunsChannel = null;
let quizQuestionsChannel = null;
let knowledgeChannel = null;

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
const EVENTS_CACHE_KEY = "bartool:events";
const SHIFT_LOGS_CACHE_KEY = "bartool:shift-logs";
const LOSSES_CACHE_KEY = "bartool:losses";
const CHECKLIST_TEMPLATES_CACHE_KEY = "bartool:checklist-templates";
const CHECKLIST_RUNS_CACHE_KEY = "bartool:checklist-runs";
const QUIZ_QUESTIONS_CACHE_KEY = "bartool:quiz-questions";
const KNOWLEDGE_CACHE_KEY = "bartool:knowledge";

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
  return new Error(t("ui.offline_aenderungen_sind_erst_wieder_mit_b6dc"));
}

// ---------------------------------------------------------------------
// Betriebsdaten je Abteilung (Paket 64/65)
//
// Ansätze, Events, Übergaben, Schwund, Checklistenvorlagen und
// Inventurzählungen tragen department (Eigentümer) und visible_to (sichtbar
// für). Durchgesetzt wird beides in der Datenbank: der Trigger
// private.betrieb_dept_guard setzt die Eigentümer-Abteilung und ergänzt sie
// in visible_to, RLS liefert nur Freigegebenes aus.
//
// Gesendet wird deshalb nur, was sich wirklich ändert:
//   - department nur beim Anlegen und nur, wenn der Aufrufer eine angibt
//     (wirkt nur mit betrieb.alle_abteilungen). Beim upsert eines
//     bestehenden Eintrags würde der Insert-Zweig des Triggers sonst die
//     eigene Abteilung einsetzen und der Update-Zweig das als Wechsel des
//     Eigentümers abweisen.
//   - visible_to nur, wenn die Menge vom zuletzt geladenen Stand abweicht.
//     Module reichen beim Abhaken oder Statuswechsel den ganzen Eintrag
//     durch; ohne diesen Vergleich bekäme eine Abteilung, die nur mitsehen
//     darf, einen Fehler, sobald der Eigentümer die Freigabe inzwischen
//     geändert hat.
// ---------------------------------------------------------------------

function fromDepartmentColumns(row) {
  return {
    department: row.department ?? null,
    visibleTo: Array.isArray(row.visible_to) ? row.visible_to : [],
  };
}

function sameKeys(a, b) {
  const links = new Set(a ?? []);
  const rechts = new Set(b ?? []);
  return links.size === rechts.size && [...links].every((key) => rechts.has(key));
}

function toDepartmentColumns(item, cache) {
  const vorher = item.id ? cache.find((eintrag) => eintrag.id === item.id) : null;
  const columns = {};
  if (!vorher && item.department) columns.department = item.department;
  if (Array.isArray(item.visibleTo) && !(vorher && sameKeys(vorher.visibleTo, item.visibleTo))) {
    columns.visible_to = [...new Set(item.visibleTo)];
  }
  return columns;
}

// Offline-Puffer der Betriebsdaten gehört genau einem Konto. Auf einem
// geteilten Tablet sähe das nächste Konto sonst offline die Einträge des
// vorigen – an RLS vorbei. Rezepte, Produkte, Quiz und Wissen sind für alle
// gleich und bleiben stehen; die Nutzereinstellungen sind ohnehin je Konto
// abgelegt.
const CACHE_OWNER_KEY = "bartool:cache-owner";
export const INVENTORY_DRAFT_PREFIX = "bartool:inventory-draft:";
const OPERATIONS_CACHE_KEYS = [
  "bartool:preparations",
  "bartool:events",
  "bartool:shift-logs",
  "bartool:losses",
  "bartool:checklist-templates",
  "bartool:checklist-runs",
  "bartool:inventory-counts",
];

export function clearOperationsCache() {
  try {
    OPERATIONS_CACHE_KEYS.forEach((key) => localStorage.removeItem(key));
    const entwuerfe = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(INVENTORY_DRAFT_PREFIX)) entwuerfe.push(key);
    }
    entwuerfe.forEach((key) => localStorage.removeItem(key));
    localStorage.removeItem(CACHE_OWNER_KEY);
  } catch {
    // Kein Zugriff auf localStorage heißt auch: nichts gepuffert.
  }
}

// Muss vor den init*Sync()-Aufrufen laufen, die zuerst den Puffer rendern.
// Ein Puffer ohne Eigentümer (Stand vor Paket 65) gilt als fremd.
export function claimOperationsCache(userId) {
  try {
    if (localStorage.getItem(CACHE_OWNER_KEY) === userId) return;
    clearOperationsCache();
    localStorage.setItem(CACHE_OWNER_KEY, userId);
  } catch {
    // siehe clearOperationsCache()
  }
}

export function operationsCacheOwner() {
  try {
    return localStorage.getItem(CACHE_OWNER_KEY);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Abteilungen und Standard-Freigaben (Tabellen "departments" und
// "department_defaults")
//
// Beide sind klein und für alle angemeldeten Konten lesbar. Gebraucht für
// die Abteilungsauswahl beim Anlegen (js/departmentPicker.js); die Labels
// bleiben unübersetzt wie in der Datenbank.
// ---------------------------------------------------------------------

const DEPARTMENTS_UPDATED_EVENT = "bartool:departments-updated";
const DEPARTMENTS_CACHE_KEY = "bartool:departments";
const DEPARTMENT_DEFAULTS_CACHE_KEY = "bartool:department-defaults";

let departmentsCache = [];
let departmentDefaultsCache = [];
let departmentsChannel = null;

async function refreshDepartments() {
  const supabase = getSupabaseClient();
  let antworten = null;
  try {
    antworten = await Promise.all([
      supabase.from("departments").select("key, label, sort").order("sort", { ascending: true }),
      supabase.from("department_defaults").select("module_key, department_key, visible_to"),
    ]);
  } catch {
    antworten = null;
  }
  const [abteilungen, vorgaben] = antworten ?? [{ error: true }, { error: true }];
  if (!abteilungen.error) {
    departmentsCache = (abteilungen.data ?? []).map((row) => ({
      key: row.key,
      label: row.label ?? row.key,
      sort: row.sort ?? 0,
    }));
    writeCache(DEPARTMENTS_CACHE_KEY, departmentsCache);
  } else {
    const buffered = readCache(DEPARTMENTS_CACHE_KEY);
    if (buffered) departmentsCache = buffered;
  }
  if (!vorgaben.error) {
    departmentDefaultsCache = (vorgaben.data ?? []).map((row) => ({
      moduleKey: row.module_key,
      departmentKey: row.department_key,
      visibleTo: Array.isArray(row.visible_to) ? row.visible_to : [],
    }));
    writeCache(DEPARTMENT_DEFAULTS_CACHE_KEY, departmentDefaultsCache);
  } else {
    const buffered = readCache(DEPARTMENT_DEFAULTS_CACHE_KEY);
    if (buffered) departmentDefaultsCache = buffered;
  }
  window.dispatchEvent(new CustomEvent(DEPARTMENTS_UPDATED_EVENT));
}

export async function initDepartmentSync() {
  const abteilungen = readCache(DEPARTMENTS_CACHE_KEY);
  const vorgaben = readCache(DEPARTMENT_DEFAULTS_CACHE_KEY);
  if (abteilungen) departmentsCache = abteilungen;
  if (vorgaben) departmentDefaultsCache = vorgaben;
  if (abteilungen || vorgaben) window.dispatchEvent(new CustomEvent(DEPARTMENTS_UPDATED_EVENT));
  await refreshDepartments();
  const supabase = getSupabaseClient();
  if (departmentsChannel) supabase.removeChannel(departmentsChannel);
  departmentsChannel = supabase
    .channel("public:departments")
    .on("postgres_changes", { event: "*", schema: "public", table: "departments" }, refreshDepartments)
    .on("postgres_changes", { event: "*", schema: "public", table: "department_defaults" }, refreshDepartments)
    .subscribe();
}

export function loadDepartments() {
  return departmentsCache;
}

export function loadDepartmentDefaults() {
  return departmentDefaultsCache;
}

export function onDepartmentsChanged(callback) {
  window.addEventListener(DEPARTMENTS_UPDATED_EVENT, callback);
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
    // Englische Zweitfassung (Paket 33); leer bleibt null, damit die Anzeige
    // sauber zwischen "nicht gepflegt" und "leer eingetragen" unterscheidet.
    method_en: recipe.methodEn || null,
    glass_en: recipe.glassEn || null,
    garnish_en: recipe.garnishEn || null,
    quick_pitch_en: recipe.quickPitchEn || null,
    pairs_with: recipe.pairsWith ?? null,
    sales_price:
      recipe.salesPrice === "" || recipe.salesPrice == null ? null : Number(recipe.salesPrice),
    image_path: recipe.imagePath || null,
    garnish_image_path: recipe.garnishImagePath || null,
  };
}

export function fromRecipeRow(row) {
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
    methodEn: row.method_en ?? "",
    glassEn: row.glass_en ?? "",
    garnishEn: row.garnish_en ?? "",
    quickPitchEn: row.quick_pitch_en ?? "",
    pairsWith: row.pairs_with ?? [],
    salesPrice: row.sales_price ?? "",
    imagePath: row.image_path ?? "",
    garnishImagePath: row.garnish_image_path ?? "",
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

// Wiederherstellen aus dem Änderungsverlauf (Paket 36). Läuft absichtlich
// nicht über saveRecipe(), sondern über public.restore_row() in der Datenbank:
// von außen ist ein Wiederherstellen ein ganz normaler Upsert und damit von
// einer Bearbeitung nicht zu unterscheiden. Nur so hängt das Recht
// audit.restore an einer echten serverseitigen Prüfung. Die Semantik ist
// dieselbe – Upsert über den Namen, nur die mitgeschickten Felder.
export async function restoreRecipe(recipe) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("restore_row", {
    p_table: "recipes",
    p_row: toRecipeRecord(recipe),
  });
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
    // Produktwissen (strukturiert) – Grundlage für Schulung und Quiz.
    abv_value: product.abvValue === "" || product.abvValue == null ? null : Number(product.abvValue),
    abv_max: product.abvMax === "" || product.abvMax == null ? null : Number(product.abvMax),
    origin_country: product.originCountry || null,
    origin_region: product.originRegion || null,
    base_material: product.baseMaterial || null,
    production_method: product.productionMethod || null,
    age_statement: product.ageStatement || null,
    flavor_tags: product.flavorTags ?? null,
    producer: product.producer || null,
    sweetness: product.sweetness || null,
    classification: product.classification || null,
    serving_temp: product.servingTemp || null,
    body: product.body || null,
    verified: Boolean(product.verified),
    verified_at: product.verifiedAt || null,
    par_level: product.parLevel === "" || product.parLevel == null ? null : Number(product.parLevel),
    supplier: product.supplier || null,
    order_unit: product.orderUnit || null,
    image_path: product.imagePath || null,
  };
}

export function fromProductRow(row) {
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
    abvValue: row.abv_value ?? "",
    abvMax: row.abv_max ?? "",
    originCountry: row.origin_country ?? "",
    originRegion: row.origin_region ?? "",
    baseMaterial: row.base_material ?? "",
    productionMethod: row.production_method ?? "",
    ageStatement: row.age_statement ?? "",
    flavorTags: row.flavor_tags ?? [],
    producer: row.producer ?? "",
    sweetness: row.sweetness ?? "",
    classification: row.classification ?? "",
    servingTemp: row.serving_temp ?? "",
    body: row.body ?? "",
    verified: row.verified ?? false,
    verifiedAt: row.verified_at ?? "",
    parLevel: row.par_level ?? "",
    supplier: row.supplier ?? "",
    orderUnit: row.order_unit ?? "",
    imagePath: row.image_path ?? "",
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

export async function saveProduct(product, options = {}) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  // Stand vor dem Speichern merken: nur so lässt sich erkennen, ob sich der
  // Einkaufspreis geändert hat und ein neuer Preisstand fällig ist.
  const previous = productsCache.find((p) => p.name === product.name) ?? null;
  const { error } = await supabase.from("products").upsert(toProductRecord(product), { onConflict: "name" });
  if (error) throw error;
  await recordPriceChange(product, previous, options.priceSource);
  await refreshProducts();
}

// Gegenstück zu restoreRecipe() – siehe Kommentar dort.
export async function restoreProduct(product) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc("restore_row", {
    p_table: "products",
    p_row: toProductRecord(product),
  });
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
  return { ...record, ...toDepartmentColumns(prep, preparationsCache) };
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
    ...fromDepartmentColumns(row),
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
// Events / Bankette (Tabelle "events" in Supabase)
//
// Gleiches Muster wie die Ansätze: Schlüssel ist die id, denn denselben
// Veranstaltungsnamen kann es mehrfach geben (jede Feier ist ein eigener
// Eintrag). Die Drinkauswahl liegt als JSON in einer Spalte – sie gehört
// immer zu genau einem Event und wird nie einzeln abgefragt.
// ---------------------------------------------------------------------

function toEventRecord(ev) {
  const zahl = (wert) => (wert === "" || wert == null ? null : Number(wert));
  const record = {
    name: ev.name,
    event_date: ev.eventDate || null,
    guests: zahl(ev.guests),
    duration_hours: zahl(ev.durationHours),
    drinks_per_guest: zahl(ev.drinksPerGuest),
    buffer_percent: zahl(ev.bufferPercent) ?? 10,
    drink_mix: Array.isArray(ev.drinkMix) ? ev.drinkMix : [],
    ice_kg_per_drink: zahl(ev.iceKgPerDrink),
    notes: ev.notes || null,
  };
  if (ev.id) record.id = ev.id;
  if (ev.createdBy) record.created_by = ev.createdBy;
  return { ...record, ...toDepartmentColumns(ev, eventsCache) };
}

function fromEventRow(row) {
  return {
    id: row.id,
    name: row.name,
    eventDate: row.event_date ?? "",
    guests: row.guests ?? "",
    durationHours: row.duration_hours ?? "",
    drinksPerGuest: row.drinks_per_guest ?? "",
    bufferPercent: row.buffer_percent ?? 10,
    drinkMix: Array.isArray(row.drink_mix) ? row.drink_mix : [],
    iceKgPerDrink: row.ice_kg_per_drink ?? "",
    notes: row.notes ?? "",
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
    ...fromDepartmentColumns(row),
  };
}

async function refreshEvents() {
  const supabase = getSupabaseClient();
  let data = null;
  let error = null;
  try {
    ({ data, error } = await supabase.from("events").select("*").order("event_date", { nullsFirst: false }));
  } catch (err) {
    error = err;
  }
  if (!error) {
    eventsCache = (data ?? []).map(fromEventRow);
    writeCache(EVENTS_CACHE_KEY, eventsCache);
  } else {
    const buffered = readCache(EVENTS_CACHE_KEY);
    if (buffered) eventsCache = buffered;
  }
  window.dispatchEvent(new CustomEvent(EVENTS_UPDATED_EVENT));
}

export async function initEventSync() {
  const buffered = readCache(EVENTS_CACHE_KEY);
  if (buffered) {
    eventsCache = buffered;
    window.dispatchEvent(new CustomEvent(EVENTS_UPDATED_EVENT));
  }
  await refreshEvents();
  const supabase = getSupabaseClient();
  if (eventsChannel) supabase.removeChannel(eventsChannel);
  eventsChannel = supabase
    .channel("public:events")
    .on("postgres_changes", { event: "*", schema: "public", table: "events" }, refreshEvents)
    .subscribe();
}

export function loadEvents() {
  return eventsCache;
}

export async function saveEvent(ev) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("events").upsert(toEventRecord(ev));
  if (error) throw error;
  await refreshEvents();
}

export async function deleteEvent(id) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) throw error;
  await refreshEvents();
}

export function onEventsChanged(callback) {
  window.addEventListener(EVENTS_UPDATED_EVENT, callback);
}

// ---------------------------------------------------------------------
// Schichtübergabe / Barbuch (Tabelle "shift_logs" in Supabase)
//
// Wie bei den Events ist der Schlüssel die id: pro Tag kann es mehrere
// Übergaben geben (früh, spät, nacht). Die offenen Punkte liegen als JSON
// am Eintrag – sie gehören immer zu genau einer Schicht und werden nie
// einzeln abgefragt.
// ---------------------------------------------------------------------

function toShiftLogRecord(log) {
  const record = {
    shift_date: log.shiftDate || null,
    shift: log.shift || "spaet",
    summary: log.summary || null,
    open_items: Array.isArray(log.openItems) ? log.openItems : [],
  };
  if (log.id) record.id = log.id;
  if (log.createdBy) record.created_by = log.createdBy;
  return { ...record, ...toDepartmentColumns(log, shiftLogsCache) };
}

function fromShiftLogRow(row) {
  return {
    id: row.id,
    shiftDate: row.shift_date ?? "",
    shift: row.shift ?? "spaet",
    summary: row.summary ?? "",
    openItems: Array.isArray(row.open_items) ? row.open_items : [],
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    ...fromDepartmentColumns(row),
  };
}

async function refreshShiftLogs() {
  const supabase = getSupabaseClient();
  let data = null;
  let error = null;
  try {
    ({ data, error } = await supabase
      .from("shift_logs")
      .select("*")
      .order("shift_date", { ascending: false })
      .order("created_at", { ascending: false }));
  } catch (err) {
    error = err;
  }
  if (!error) {
    shiftLogsCache = (data ?? []).map(fromShiftLogRow);
    writeCache(SHIFT_LOGS_CACHE_KEY, shiftLogsCache);
  } else {
    const buffered = readCache(SHIFT_LOGS_CACHE_KEY);
    if (buffered) shiftLogsCache = buffered;
  }
  window.dispatchEvent(new CustomEvent(SHIFT_LOGS_UPDATED_EVENT));
}

export async function initShiftLogSync() {
  const buffered = readCache(SHIFT_LOGS_CACHE_KEY);
  if (buffered) {
    shiftLogsCache = buffered;
    window.dispatchEvent(new CustomEvent(SHIFT_LOGS_UPDATED_EVENT));
  }
  await refreshShiftLogs();
  const supabase = getSupabaseClient();
  if (shiftLogsChannel) supabase.removeChannel(shiftLogsChannel);
  shiftLogsChannel = supabase
    .channel("public:shift_logs")
    .on("postgres_changes", { event: "*", schema: "public", table: "shift_logs" }, refreshShiftLogs)
    .subscribe();
}

export function loadShiftLogs() {
  return shiftLogsCache;
}

export async function saveShiftLog(log) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("shift_logs").upsert(toShiftLogRecord(log));
  if (error) throw error;
  await refreshShiftLogs();
}

export async function deleteShiftLog(id) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("shift_logs").delete().eq("id", id);
  if (error) throw error;
  await refreshShiftLogs();
}

export function onShiftLogsChanged(callback) {
  window.addEventListener(SHIFT_LOGS_UPDATED_EVENT, callback);
}


// ---------------------------------------------------------------------
// Schwund-, Bruch- und Verkostungsbuch (Tabelle "losses")
//
// Eine Buchung gehoert immer genau einem Nutzer: recorded_by wird beim
// Anlegen gesetzt und danach nie mehr angefasst, weil die RLS-Policy daran
// haengt (aendern und loeschen darf nur der Autor oder ein Admin). Ein
// upsert ohne recorded_by wuerde serverseitig abgelehnt, deshalb bleibt das
// Feld hier immer erhalten.
// ---------------------------------------------------------------------

function toLossRecord(loss) {
  const record = {
    product_name: loss.productName,
    amount: loss.amount === "" || loss.amount == null ? null : Number(loss.amount),
    amount_unit: loss.amountUnit || "ml",
    reason: loss.reason,
    note: loss.note || null,
    occurred_at: loss.occurredAt || new Date().toISOString(),
  };
  if (loss.id) record.id = loss.id;
  if (loss.recordedBy) record.recorded_by = loss.recordedBy;
  return { ...record, ...toDepartmentColumns(loss, lossesCache) };
}

function fromLossRow(row) {
  return {
    id: row.id,
    productName: row.product_name ?? "",
    amount: row.amount == null ? "" : Number(row.amount),
    amountUnit: row.amount_unit ?? "ml",
    reason: row.reason ?? "",
    note: row.note ?? "",
    recordedBy: row.recorded_by ?? null,
    occurredAt: row.occurred_at ?? null,
    createdAt: row.created_at ?? null,
    ...fromDepartmentColumns(row),
  };
}

async function refreshLosses() {
  const supabase = getSupabaseClient();
  let data = null;
  let error = null;
  try {
    ({ data, error } = await supabase.from("losses").select("*").order("occurred_at", { ascending: false }));
  } catch (err) {
    error = err;
  }
  if (!error) {
    lossesCache = (data ?? []).map(fromLossRow);
    writeCache(LOSSES_CACHE_KEY, lossesCache);
  } else {
    const buffered = readCache(LOSSES_CACHE_KEY);
    if (buffered) lossesCache = buffered;
  }
  window.dispatchEvent(new CustomEvent(LOSSES_UPDATED_EVENT));
}

export async function initLossSync() {
  const buffered = readCache(LOSSES_CACHE_KEY);
  if (buffered) {
    lossesCache = buffered;
    window.dispatchEvent(new CustomEvent(LOSSES_UPDATED_EVENT));
  }
  await refreshLosses();
  const supabase = getSupabaseClient();
  if (lossesChannel) supabase.removeChannel(lossesChannel);
  lossesChannel = supabase
    .channel("public:losses")
    .on("postgres_changes", { event: "*", schema: "public", table: "losses" }, refreshLosses)
    .subscribe();
}

export function loadLosses() {
  return lossesCache;
}

export async function saveLoss(loss) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("losses").upsert(toLossRecord(loss));
  if (error) throw error;
  await refreshLosses();
}

export async function deleteLoss(id) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("losses").delete().eq("id", id);
  if (error) throw error;
  await refreshLosses();
}

export function onLossesChanged(callback) {
  window.addEventListener(LOSSES_UPDATED_EVENT, callback);
}


// ---------------------------------------------------------------------
// Checklisten (Tabellen "checklist_templates" und "checklist_runs")
//
// Zwei Datenarten, die zusammengehören: die Vorlage sagt, was zu prüfen
// ist, der Lauf ist der ausgefüllte Nachweis eines Tages. Beide sind
// klein genug für den üblichen Cache – gelesen werden immer alle
// Vorlagen und die letzten Läufe, nie einzelne Zeilen.
// ---------------------------------------------------------------------

// Wie viele Läufe geladen werden. Der Verlauf zeigt 30 – etwas Reserve,
// damit auch bei mehreren Vorlagen pro Tag genug zusammenkommt.
const CHECKLIST_RUNS_LIMIT = 300;

function toChecklistTemplateRecord(template) {
  const record = {
    name: template.name,
    // Englischer Vorlagenname (Paket 33). Die englischen Punkte selbst stehen
    // als labelEn/hintEn in den items.
    name_en: template.nameEn || null,
    kind: template.kind || "sonstiges",
    items: Array.isArray(template.items) ? template.items : [],
    active: template.active !== false,
  };
  if (template.id) record.id = template.id;
  return { ...record, ...toDepartmentColumns(template, checklistTemplatesCache) };
}

function fromChecklistTemplateRow(row) {
  return {
    id: row.id,
    name: row.name ?? "",
    nameEn: row.name_en ?? "",
    kind: row.kind ?? "sonstiges",
    items: Array.isArray(row.items) ? row.items : [],
    active: row.active !== false,
    updatedAt: row.updated_at ?? null,
    ...fromDepartmentColumns(row),
  };
}

async function refreshChecklistTemplates() {
  const supabase = getSupabaseClient();
  let data = null;
  let error = null;
  try {
    ({ data, error } = await supabase.from("checklist_templates").select("*").order("name"));
  } catch (err) {
    error = err;
  }
  if (!error) {
    checklistTemplatesCache = (data ?? []).map(fromChecklistTemplateRow);
    writeCache(CHECKLIST_TEMPLATES_CACHE_KEY, checklistTemplatesCache);
  } else {
    const buffered = readCache(CHECKLIST_TEMPLATES_CACHE_KEY);
    if (buffered) checklistTemplatesCache = buffered;
  }
  window.dispatchEvent(new CustomEvent(CHECKLIST_TEMPLATES_UPDATED_EVENT));
}

export async function initChecklistTemplateSync() {
  const buffered = readCache(CHECKLIST_TEMPLATES_CACHE_KEY);
  if (buffered) {
    checklistTemplatesCache = buffered;
    window.dispatchEvent(new CustomEvent(CHECKLIST_TEMPLATES_UPDATED_EVENT));
  }
  await refreshChecklistTemplates();
  const supabase = getSupabaseClient();
  if (checklistTemplatesChannel) supabase.removeChannel(checklistTemplatesChannel);
  checklistTemplatesChannel = supabase
    .channel("public:checklist_templates")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "checklist_templates" },
      refreshChecklistTemplates
    )
    .subscribe();
}

export function loadChecklistTemplates() {
  return checklistTemplatesCache;
}

export async function saveChecklistTemplate(template) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("checklist_templates").upsert(toChecklistTemplateRecord(template));
  if (error) throw error;
  await refreshChecklistTemplates();
}

export async function deleteChecklistTemplate(id) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("checklist_templates").delete().eq("id", id);
  if (error) throw error;
  await refreshChecklistTemplates();
  // Läufe hängen per "on delete cascade" an der Vorlage – der lokale
  // Cache weiß davon nichts und muss nachgezogen werden.
  await refreshChecklistRuns();
}

export function onChecklistTemplatesChanged(callback) {
  window.addEventListener(CHECKLIST_TEMPLATES_UPDATED_EVENT, callback);
}

function toChecklistRunRecord(run) {
  const record = {
    template_id: run.templateId || null,
    run_date: run.runDate || null,
    entries: Array.isArray(run.entries) ? run.entries : [],
    finished_at: run.finishedAt || null,
  };
  if (run.id) record.id = run.id;
  if (run.createdBy) record.created_by = run.createdBy;
  return record;
}

function fromChecklistRunRow(row) {
  return {
    id: row.id,
    templateId: row.template_id ?? null,
    runDate: row.run_date ?? "",
    entries: Array.isArray(row.entries) ? row.entries : [],
    finishedAt: row.finished_at ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

async function refreshChecklistRuns() {
  const supabase = getSupabaseClient();
  let data = null;
  let error = null;
  try {
    ({ data, error } = await supabase
      .from("checklist_runs")
      .select("*")
      .order("run_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(CHECKLIST_RUNS_LIMIT));
  } catch (err) {
    error = err;
  }
  if (!error) {
    checklistRunsCache = (data ?? []).map(fromChecklistRunRow);
    writeCache(CHECKLIST_RUNS_CACHE_KEY, checklistRunsCache);
  } else {
    const buffered = readCache(CHECKLIST_RUNS_CACHE_KEY);
    if (buffered) checklistRunsCache = buffered;
  }
  window.dispatchEvent(new CustomEvent(CHECKLIST_RUNS_UPDATED_EVENT));
}

export async function initChecklistRunSync() {
  const buffered = readCache(CHECKLIST_RUNS_CACHE_KEY);
  if (buffered) {
    checklistRunsCache = buffered;
    window.dispatchEvent(new CustomEvent(CHECKLIST_RUNS_UPDATED_EVENT));
  }
  await refreshChecklistRuns();
  const supabase = getSupabaseClient();
  if (checklistRunsChannel) supabase.removeChannel(checklistRunsChannel);
  checklistRunsChannel = supabase
    .channel("public:checklist_runs")
    .on("postgres_changes", { event: "*", schema: "public", table: "checklist_runs" }, refreshChecklistRuns)
    .subscribe();
}

export function loadChecklistRuns() {
  return checklistRunsCache;
}

export async function saveChecklistRun(run) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("checklist_runs").upsert(toChecklistRunRecord(run));
  if (error) throw error;
  await refreshChecklistRuns();
}

export async function deleteChecklistRun(id) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("checklist_runs").delete().eq("id", id);
  if (error) throw error;
  await refreshChecklistRuns();
}

export function onChecklistRunsChanged(callback) {
  window.addEventListener(CHECKLIST_RUNS_UPDATED_EVENT, callback);
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
    ...fromDepartmentColumns(row),
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
  Object.assign(record, toDepartmentColumns(count, countsCache));
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

// ---------------------------------------------------------------------
// Quizfragen (Tabelle "quiz_questions" in Supabase)
//
// Gleiches Muster wie Rezepte und Produkte, mit zwei Besonderheiten:
//
//   1. Seitenweise laden. Der Generator (js/quizGenerator.js) schreibt seine
//      Fragen als Zeilen in die Tabelle (js/quizSync.js); das sind ein paar
//      tausend. PostgREST liefert pro Anfrage höchstens 1000 Zeilen, ein
//      schlichtes select() würde den Pool also still abschneiden.
//   2. Inaktive Fragen kommen mit. Das Quiz filtert selbst auf active, die
//      Fragentabelle im Adminbereich braucht auch die abgeschalteten.
// ---------------------------------------------------------------------

const QUIZ_PAGE = 1000;

export function fromQuizQuestionRow(row) {
  return {
    id: row.id,
    questionKey: row.question_key ?? "",
    question: row.question ?? "",
    options: Array.isArray(row.options) ? row.options : [],
    correctIndex: Number(row.correct_index) || 0,
    explanation: row.explanation ?? "",
    topic: row.topic ?? "",
    parentTopic: row.parent_topic ?? "",
    difficulty: Number(row.difficulty) || 2,
    refProduct: row.ref_product ?? "",
    refRecipe: row.ref_recipe ?? "",
    source: row.source === "generator" ? "generator" : "kuratiert",
    edited: row.edited ?? false,
    active: row.active !== false,
    updatedAt: row.updated_at ?? "",
  };
}

export function toQuizQuestionRecord(frage) {
  return {
    question_key: frage.questionKey || null,
    question: frage.question,
    options: frage.options,
    correct_index: frage.correctIndex,
    explanation: frage.explanation ?? "",
    topic: frage.topic || "Servicewissen",
    parent_topic: frage.parentTopic || null,
    difficulty: frage.difficulty ?? 2,
    ref_product: frage.refProduct || null,
    ref_recipe: frage.refRecipe || null,
    source: frage.source === "generator" ? "generator" : "kuratiert",
    active: frage.active !== false,
  };
}

async function fetchAllQuizQuestions() {
  const supabase = getSupabaseClient();
  const alle = [];
  for (let von = 0; ; von += QUIZ_PAGE) {
    const { data, error } = await supabase
      .from("quiz_questions")
      .select("*")
      .order("topic")
      .order("question")
      .range(von, von + QUIZ_PAGE - 1);
    if (error) throw error;
    alle.push(...(data ?? []));
    if ((data ?? []).length < QUIZ_PAGE) return alle;
  }
}

async function refreshQuizQuestions() {
  try {
    quizQuestionsCache = (await fetchAllQuizQuestions()).map(fromQuizQuestionRow);
    writeCache(QUIZ_QUESTIONS_CACHE_KEY, quizQuestionsCache);
  } catch {
    const buffered = readCache(QUIZ_QUESTIONS_CACHE_KEY);
    if (buffered) quizQuestionsCache = buffered;
  }
  window.dispatchEvent(new CustomEvent(QUIZ_QUESTIONS_UPDATED_EVENT));
}

export async function initQuizQuestionSync() {
  const buffered = readCache(QUIZ_QUESTIONS_CACHE_KEY);
  if (buffered) {
    quizQuestionsCache = buffered;
    window.dispatchEvent(new CustomEvent(QUIZ_QUESTIONS_UPDATED_EVENT));
  }
  await refreshQuizQuestions();
  const supabase = getSupabaseClient();
  if (quizQuestionsChannel) supabase.removeChannel(quizQuestionsChannel);
  // Ein Sync-Lauf schreibt tausende Zeilen und würde ebenso viele Ereignisse
  // auslösen. Deshalb wird das Neuladen gebündelt, nicht pro Zeile.
  let sammelTimer = null;
  quizQuestionsChannel = supabase
    .channel("public:quiz_questions")
    .on("postgres_changes", { event: "*", schema: "public", table: "quiz_questions" }, () => {
      clearTimeout(sammelTimer);
      sammelTimer = setTimeout(refreshQuizQuestions, 1500);
    })
    .subscribe();
}

export function loadQuizQuestions() {
  return quizQuestionsCache;
}

export async function saveQuizQuestion(frage) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const datensatz = toQuizQuestionRecord(frage);
  if (frage.id) {
    // Von Hand geändert: der nächste Katalog-Abgleich lässt die Zeile in Ruhe.
    const { error } = await supabase
      .from("quiz_questions")
      .update({ ...datensatz, edited: true })
      .eq("id", frage.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("quiz_questions").insert(datensatz);
    if (error) throw error;
  }
  await refreshQuizQuestions();
}

export async function deleteQuizQuestion(id) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("quiz_questions").delete().eq("id", id);
  if (error) throw error;
  await refreshQuizQuestions();
}

// Für den Katalog-Abgleich (js/quizSync.js): schreibt einen Block Fragen und
// lädt bewusst nicht nach – das macht der Aufrufer einmal am Ende.
export async function upsertQuizQuestions(zeilen) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("quiz_questions")
    .upsert(zeilen, { onConflict: "question_key" });
  if (error) throw error;
}

export async function setQuizQuestionsActive(ids, active) {
  if (!ids.length) return;
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  // Die IDs stehen in der URL (`id=in.(…)`): ab ein paar Hundert reißt die
  // Längengrenze, deshalb in Blöcken.
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await supabase.from("quiz_questions").update({ active }).in("id", ids.slice(i, i + 100));
    if (error) throw error;
  }
}

export async function reloadQuizQuestions() {
  await refreshQuizQuestions();
}

export function onQuizQuestionsChanged(callback) {
  window.addEventListener(QUIZ_QUESTIONS_UPDATED_EVENT, callback);
}

// ---------------------------------------------------------------------
// Wissen (Tabellen "knowledge_articles" und "knowledge_reads", Paket 53)
//
// Artikel nach dem Muster der Rezepte, mit zwei Besonderheiten:
//
//   1. Der Offline-Puffer enthält nur veröffentlichte Artikel. localStorage
//      gehört dem Gerät, nicht dem Konto – am geteilten Tresen-Tablet sähe
//      sonst das nächste Konto offline die Entwürfe der Barleitung, die ihm
//      die Datenbank (RLS) gerade nicht zeigt.
//   2. Der Gelesen-Status ist pro Konto und landet aus demselben Grund gar
//      nicht im localStorage, nur im Speicher. read_at setzt die Datenbank
//      (Serverzeit, Trigger), damit der Vergleich mit updated_at stimmt.
// ---------------------------------------------------------------------

export function fromKnowledgeRow(row) {
  return {
    id: row.id,
    title: row.title ?? "",
    category: row.category ?? "",
    summary: row.summary ?? "",
    sections: Array.isArray(row.sections) ? row.sections : [],
    departments: Array.isArray(row.departments) ? row.departments : [],
    imagePath: row.image_path ?? null,
    sort: Number(row.sort) || 0,
    // Lernkarten-Metadaten (Paket 56). berufe, jahr, level und tags pflegt der
    // Editor; slug, lernfeld und pruefung kommen nur per SQL-Import und bleiben
    // beim Speichern unangetastet (toKnowledgeRecord schickt sie nicht mit).
    slug: row.slug ?? null,
    berufe: Array.isArray(row.berufe) ? row.berufe : [],
    lernfeld: Array.isArray(row.lernfeld) ? row.lernfeld : [],
    pruefung: Array.isArray(row.pruefung) ? row.pruefung : [],
    jahr: Number.isInteger(row.jahr) ? row.jahr : null,
    level: row.level ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    sources: Array.isArray(row.sources) ? row.sources : [],
    reviewedAt: row.reviewed_at ?? null,
    reviewedBy: row.reviewed_by ?? "",
    published: row.published === true,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
  };
}

function toKnowledgeRecord(article) {
  return {
    title: (article.title ?? "").trim(),
    category: (article.category ?? "").trim(),
    summary: article.summary?.trim() || null,
    sections: Array.isArray(article.sections) ? article.sections : [],
    departments: Array.isArray(article.departments) ? article.departments : [],
    image_path: article.imagePath || null,
    sort: Number(article.sort) || 0,
    berufe: Array.isArray(article.berufe) ? article.berufe : [],
    jahr: Number.isInteger(article.jahr) ? article.jahr : null,
    level: article.level || null,
    tags: Array.isArray(article.tags) ? article.tags : [],
    sources: Array.isArray(article.sources) ? article.sources : [],
    reviewed_at: article.reviewedAt || null,
    reviewed_by: article.reviewedBy?.trim() || null,
    published: article.published === true,
  };
}

async function refreshKnowledge() {
  const supabase = getSupabaseClient();
  let data = null;
  let error = null;
  try {
    ({ data, error } = await supabase
      .from("knowledge_articles")
      .select("*")
      .order("category")
      .order("sort")
      .order("title"));
  } catch (err) {
    error = err;
  }
  if (!error) {
    knowledgeCache = (data ?? []).map(fromKnowledgeRow);
    writeCache(KNOWLEDGE_CACHE_KEY, knowledgeCache.filter((a) => a.published));
  } else {
    const buffered = readCache(KNOWLEDGE_CACHE_KEY);
    if (buffered) knowledgeCache = buffered;
  }
  window.dispatchEvent(new CustomEvent(KNOWLEDGE_UPDATED_EVENT));
}

async function refreshKnowledgeReads() {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase.from("knowledge_reads").select("article_id, read_at");
    if (error) throw error;
    knowledgeReadsCache = new Map((data ?? []).map((row) => [row.article_id, row.read_at]));
  } catch {
    // Kein Netz: bekannten Stand behalten, nichts erfinden.
  }
  window.dispatchEvent(new CustomEvent(KNOWLEDGE_UPDATED_EVENT));
}

export async function initKnowledgeSync() {
  const buffered = readCache(KNOWLEDGE_CACHE_KEY);
  if (buffered) {
    knowledgeCache = buffered;
    window.dispatchEvent(new CustomEvent(KNOWLEDGE_UPDATED_EVENT));
  }
  // Nach einem Kontowechsel darf kein fremder Gelesen-Status stehen bleiben.
  knowledgeReadsCache = new Map();
  await Promise.all([refreshKnowledge(), refreshKnowledgeReads()]);
  const supabase = getSupabaseClient();
  if (knowledgeChannel) supabase.removeChannel(knowledgeChannel);
  knowledgeChannel = supabase
    .channel("public:knowledge_articles")
    .on("postgres_changes", { event: "*", schema: "public", table: "knowledge_articles" }, refreshKnowledge)
    .subscribe();
}

export function loadKnowledge() {
  return knowledgeCache;
}

// Neu ohne id, sonst Update über die id (der Titel ist änderbar). Gibt den
// gespeicherten Artikel zurück – das Titelbild (wissen/<uuid>.jpg) braucht
// die id eines neuen Artikels. Ein Veröffentlichen ohne Quelle oder
// Prüfvermerk lehnt die Datenbank ab (CHECK-Constraint), nicht nur das Formular.
export async function saveKnowledge(article) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const record = toKnowledgeRecord(article);
  const query = article.id
    ? supabase.from("knowledge_articles").update(record).eq("id", article.id)
    : supabase.from("knowledge_articles").insert(record);
  const { data, error } = await query.select().single();
  if (error) throw error;
  await refreshKnowledge();
  return fromKnowledgeRow(data);
}

export async function deleteKnowledge(id) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("knowledge_articles").delete().eq("id", id);
  if (error) throw error;
  await refreshKnowledge();
}

// Map article_id -> read_at (ISO-String) des angemeldeten Kontos.
export function loadKnowledgeReads() {
  return knowledgeReadsCache;
}

export async function markKnowledgeRead(articleId) {
  if (isOffline()) throw offlineWriteError();
  const supabase = getSupabaseClient();
  // user_id setzt die Datenbank (default auth.uid()), read_at der Trigger.
  const { data, error } = await supabase
    .from("knowledge_reads")
    .upsert({ article_id: articleId }, { onConflict: "user_id,article_id" })
    .select("article_id, read_at")
    .single();
  if (error) throw error;
  knowledgeReadsCache.set(data.article_id, data.read_at);
  window.dispatchEvent(new CustomEvent(KNOWLEDGE_UPDATED_EVENT));
}

export function onKnowledgeChanged(callback) {
  window.addEventListener(KNOWLEDGE_UPDATED_EVENT, callback);
}

// ---------------------------------------------------------------------
// Persönliche Einstellungen (Tabelle "user_preferences" in Supabase)
//
// Eine Zeile je Konto, nur für das eigene Konto les- und schreibbar (RLS).
// home_tiles / admin_tiles: Reihenfolge und ausgeblendete Kacheln der
// Startseite bzw. Admin-Übersicht ({ order: [...], hidden: [...] },
// Schlüssel = data-tab, siehe js/tileGrid.js).
//
// Anders als die Kataloge darf hier auch offline gespeichert werden: die
// Änderung landet sofort im Puffer (Feld pending) und geht beim nächsten
// Netzkontakt per upsert an die Datenbank. Der Puffer ist pro Konto
// geschlüsselt – am geteilten Tresen-Tablet bekäme sonst das nächste Konto
// die Startseite des vorigen.
// ---------------------------------------------------------------------

const USER_PREFERENCES_UPDATED_EVENT = "bartool:user-preferences-updated";
const USER_PREFERENCES_CACHE_PREFIX = "bartool:user-preferences:";

const EMPTY_USER_PREFERENCES = { homeTiles: {}, adminTiles: {} };

let userPreferencesCache = EMPTY_USER_PREFERENCES;
let userPreferencesUserId = null;
let userPreferencesPending = false;
let userPreferencesWrite = Promise.resolve();
let userPreferencesOnlineHooked = false;

function tileObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeUserPreferences(prefs) {
  return {
    homeTiles: tileObject(prefs?.homeTiles),
    adminTiles: tileObject(prefs?.adminTiles),
  };
}

function readUserPreferencesCache(userId) {
  try {
    const raw = localStorage.getItem(USER_PREFERENCES_CACHE_PREFIX + userId);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeUserPreferencesCache() {
  if (!userPreferencesUserId) return;
  try {
    localStorage.setItem(
      USER_PREFERENCES_CACHE_PREFIX + userPreferencesUserId,
      JSON.stringify({ ...userPreferencesCache, pending: userPreferencesPending })
    );
  } catch {
    // Kein Platz oder kein Zugriff: der Puffer ist Komfort, kein Muss.
  }
}

async function refreshUserPreferences() {
  const supabase = getSupabaseClient();
  try {
    const { data, error } = await supabase
      .from("user_preferences")
      .select("home_tiles, admin_tiles")
      .eq("user_id", userPreferencesUserId)
      .maybeSingle();
    if (error) throw error;
    // Während des Ladens lokal geändert: der lokale Stand ist neuer.
    if (userPreferencesPending) return;
    userPreferencesCache = normalizeUserPreferences({
      homeTiles: data?.home_tiles,
      adminTiles: data?.admin_tiles,
    });
    writeUserPreferencesCache();
  } catch {
    // Kein Netz: Puffer behalten.
  }
  window.dispatchEvent(new CustomEvent(USER_PREFERENCES_UPDATED_EVENT));
}

// Schreibt den aktuellen Stand, wenn er noch aussteht. Aufrufe laufen
// nacheinander, damit ein langsamer älterer upsert keinen neueren überholt.
function flushUserPreferences() {
  userPreferencesWrite = userPreferencesWrite.then(async () => {
    if (!userPreferencesPending || !userPreferencesUserId || isOffline()) return;
    const snapshot = userPreferencesCache;
    const supabase = getSupabaseClient();
    try {
      const { error } = await supabase
        .from("user_preferences")
        .upsert(
          { user_id: userPreferencesUserId, home_tiles: snapshot.homeTiles, admin_tiles: snapshot.adminTiles },
          { onConflict: "user_id" }
        );
      if (error) throw error;
      // Nur abhaken, wenn in der Zwischenzeit nichts Neueres kam.
      if (userPreferencesCache === snapshot) {
        userPreferencesPending = false;
        writeUserPreferencesCache();
      }
    } catch {
      // Bleibt pending und geht beim nächsten "online" oder Start raus.
    }
  });
  return userPreferencesWrite;
}

export async function initUserPreferencesSync() {
  const supabase = getSupabaseClient();
  let userId = null;
  try {
    const { data } = await supabase.auth.getSession();
    userId = data?.session?.user?.id ?? null;
  } catch {
    userId = null;
  }
  userPreferencesUserId = userId;
  userPreferencesCache = EMPTY_USER_PREFERENCES;
  userPreferencesPending = false;
  if (!userId) {
    window.dispatchEvent(new CustomEvent(USER_PREFERENCES_UPDATED_EVENT));
    return;
  }
  const buffered = readUserPreferencesCache(userId);
  if (buffered) {
    userPreferencesCache = normalizeUserPreferences(buffered);
    userPreferencesPending = buffered.pending === true;
  }
  window.dispatchEvent(new CustomEvent(USER_PREFERENCES_UPDATED_EVENT));
  if (!userPreferencesOnlineHooked) {
    userPreferencesOnlineHooked = true;
    window.addEventListener("online", () => flushUserPreferences());
  }
  if (userPreferencesPending) await flushUserPreferences();
  else await refreshUserPreferences();
}

export function loadUserPreferences() {
  return userPreferencesCache;
}

// Übernimmt die Änderung sofort (auch offline) und schreibt im Hintergrund.
// Gibt das Promise des Schreibvorgangs zurück; ein Fehler bleibt im Puffer
// stehen und wird nicht geworfen.
export function saveUserPreferences(changes) {
  userPreferencesCache = normalizeUserPreferences({ ...userPreferencesCache, ...changes });
  userPreferencesPending = true;
  writeUserPreferencesCache();
  window.dispatchEvent(new CustomEvent(USER_PREFERENCES_UPDATED_EVENT));
  return flushUserPreferences();
}

export function onUserPreferencesChanged(callback) {
  window.addEventListener(USER_PREFERENCES_UPDATED_EVENT, callback);
}
