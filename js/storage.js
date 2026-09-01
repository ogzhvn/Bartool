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
    unit: product.unit || null,
    price: product.price === "" || product.price == null ? null : Number(product.price),
    note: product.note || null,
  };
}

function fromProductRow(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category ?? "",
    unit: row.unit ?? "",
    price: row.price ?? "",
    note: row.note ?? "",
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
