import { getSupabaseClient } from "./supabaseClient.js";

const RECIPES_UPDATED_EVENT = "bartool:recipes-updated";
const PRODUCTS_UPDATED_EVENT = "bartool:products-updated";

let recipesCache = [];
let productsCache = [];
let recipesChannel = null;
let productsChannel = null;

// ---------------------------------------------------------------------
// Rezepte (Tabelle "recipes" in Supabase)
// ---------------------------------------------------------------------

function toRecipeRecord(recipe) {
  return {
    name: recipe.name,
    base_portions: recipe.basePortions,
    ingredients: recipe.ingredients,
    method: recipe.method || null,
    glass: recipe.glass || null,
    garnish: recipe.garnish || null,
    ice: recipe.ice || null,
    history: recipe.history || null,
    quick_pitch: recipe.quickPitch || null,
    pairs_with: recipe.pairsWith ?? null,
  };
}

function fromRecipeRow(row) {
  return {
    name: row.name,
    basePortions: row.base_portions,
    ingredients: row.ingredients ?? [],
    method: row.method ?? "",
    glass: row.glass ?? "",
    garnish: row.garnish ?? "",
    ice: row.ice ?? "",
    history: row.history ?? "",
    quickPitch: row.quick_pitch ?? "",
    pairsWith: row.pairs_with ?? [],
  };
}

async function refreshRecipes() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("recipes").select("*").order("name");
  if (!error) recipesCache = (data ?? []).map(fromRecipeRow);
  window.dispatchEvent(new CustomEvent(RECIPES_UPDATED_EVENT));
}

// Einmal beim App-Start (nach dem Login) aufrufen: lädt den Cache initial
// und hält ihn per Realtime synchron, damit Änderungen von anderen
// Geräten/Nutzern automatisch ankommen.
export async function initRecipeSync() {
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
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("recipes").upsert(toRecipeRecord(recipe), { onConflict: "name" });
  if (error) throw error;
  await refreshRecipes();
}

export async function deleteRecipe(name) {
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
  };
}

async function refreshProducts() {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("products").select("*").order("name");
  if (!error) productsCache = (data ?? []).map(fromProductRow);
  window.dispatchEvent(new CustomEvent(PRODUCTS_UPDATED_EVENT));
}

export async function initProductSync() {
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
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("products").upsert(toProductRecord(product), { onConflict: "name" });
  if (error) throw error;
  await refreshProducts();
}

export async function deleteProduct(name) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("products").delete().eq("name", name);
  if (error) throw error;
  await refreshProducts();
}

export function onProductsChanged(callback) {
  window.addEventListener(PRODUCTS_UPDATED_EVENT, callback);
}
