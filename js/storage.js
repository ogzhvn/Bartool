import { getSupabaseClient } from "./supabaseClient.js";
import { recordPriceChange } from "./priceHistory.js";

const RECIPES_UPDATED_EVENT = "bartool:recipes-updated";
const PRODUCTS_UPDATED_EVENT = "bartool:products-updated";
const PREPARATIONS_UPDATED_EVENT = "bartool:preparations-updated";
const EVENTS_UPDATED_EVENT = "bartool:events-updated";
const SHIFT_LOGS_UPDATED_EVENT = "bartool:shift-logs-updated";
const CHECKLIST_TEMPLATES_UPDATED_EVENT = "bartool:checklist-templates-updated";
const CHECKLIST_RUNS_UPDATED_EVENT = "bartool:checklist-runs-updated";

let recipesCache = [];
let productsCache = [];
let preparationsCache = [];
let eventsCache = [];
let shiftLogsCache = [];
let checklistTemplatesCache = [];
let checklistRunsCache = [];
let recipesChannel = null;
let productsChannel = null;
let preparationsChannel = null;
let eventsChannel = null;
let shiftLogsChannel = null;
let checklistTemplatesChannel = null;
let checklistRunsChannel = null;

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
const CHECKLIST_TEMPLATES_CACHE_KEY = "bartool:checklist-templates";
const CHECKLIST_RUNS_CACHE_KEY = "bartool:checklist-runs";

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
  return record;
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
  return record;
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
    kind: template.kind || "sonstiges",
    items: Array.isArray(template.items) ? template.items : [],
    active: template.active !== false,
  };
  if (template.id) record.id = template.id;
  return record;
}

function fromChecklistTemplateRow(row) {
  return {
    id: row.id,
    name: row.name ?? "",
    kind: row.kind ?? "sonstiges",
    items: Array.isArray(row.items) ? row.items : [],
    active: row.active !== false,
    updatedAt: row.updated_at ?? null,
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
