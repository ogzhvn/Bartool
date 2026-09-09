// Fotos für Produkte und Rezepte: Verkleinerung im Browser, Ablage im
// privaten Storage-Bucket "bilder" und Auflösung von image_path zu einer
// anzeigbaren (signierten) URL.
//
// Pfadschema: produkte/<uuid>.jpg für Produktfotos, rezepte/<uuid>.jpg für
// Rezeptfotos. Nie der Name im Pfad, sonst bricht jede Umbenennung das Bild.
import { getSupabaseClient } from "./supabaseClient.js";

const BUCKET = "bilder";
const MAX_EDGE = 1200;
const JPEG_QUALITY = 0.8;
// Signierte URLs eine Stunde gültig, im Cache 1 Minute früher ablaufen
// lassen als am Server, damit nie eine schon abgelaufene URL ausgeliefert wird.
const SIGNED_URL_TTL_SECONDS = 3600;

// Signierte URLs pro Session zwischenspeichern, damit nicht bei jedem
// Rendern derselben Liste erneut signiert werden muss.
const urlCache = new Map();

async function resizeToJpeg(file) {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  if (width > MAX_EDGE || height > MAX_EDGE) {
    const scale = MAX_EDGE / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Bild konnte nicht verkleinert werden."))),
      "image/jpeg",
      JPEG_QUALITY
    );
  });
}

async function uploadPhoto(file, folder) {
  const blob = await resizeToJpeg(file);
  const path = `${folder}/${crypto.randomUUID()}.jpg`;
  const supabase = getSupabaseClient();
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

async function deletePhoto(path) {
  if (!path) return;
  const supabase = getSupabaseClient();
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
  urlCache.delete(path);
}

export function uploadProductPhoto(file) {
  return uploadPhoto(file, "produkte");
}

export function deleteProductPhoto(path) {
  return deletePhoto(path);
}

export function uploadRecipePhoto(file) {
  return uploadPhoto(file, "rezepte");
}

export function deleteRecipePhoto(path) {
  return deletePhoto(path);
}

// Löst image_path zu einer anzeigbaren URL auf, oder null (kein Pfad, oder
// offline/Fehler beim Signieren – der Aufrufer zeigt dann den Platzhalter).
export async function resolveImageUrl(path) {
  if (!path) return null;
  const cached = urlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data) return null;
    urlCache.set(path, {
      url: data.signedUrl,
      expiresAt: Date.now() + (SIGNED_URL_TTL_SECONDS - 60) * 1000,
    });
    return data.signedUrl;
  } catch {
    // Offline oder Netzfehler: kein Absturz, nur kein Bild.
    return null;
  }
}
