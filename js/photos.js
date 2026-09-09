// Produktfotos: Verkleinerung im Browser, Upload/Löschen im privaten
// Storage-Bucket "bilder" und Auflösen von image_path zu einer signierten,
// zeitlich begrenzten URL. Der Bucket ist bewusst nicht öffentlich (Paket 30,
// Entscheidung vom 09.09.2026) – ohne Login ist ein Bild auch mit bekannter
// URL nicht abrufbar.
import { getSupabaseClient } from "./supabaseClient.js";
import { isAdmin } from "./auth.js";

const BUCKET = "bilder";
const MAX_EDGE_PX = 1200;
const JPEG_QUALITY = 0.8;
const SIGNED_URL_TTL_SECONDS = 3600;

// path -> { url, expiresAt }. Signierte URLs pro Session cachen, statt bei
// jeder Anzeige neu zu signieren.
const urlCache = new Map();

function resizeToJpeg(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      const longEdge = Math.max(width, height);
      if (longEdge > MAX_EDGE_PX) {
        const scale = MAX_EDGE_PX / longEdge;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Bild konnte nicht verkleinert werden."))),
        "image/jpeg",
        JPEG_QUALITY
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Datei ist kein lesbares Bild."));
    };
    img.src = objectUrl;
  });
}

// Lädt ein Handyfoto verkleinert hoch und gibt den neuen image_path zurück.
// Wirft, wenn kein Admin (Policy lehnt es serverseitig ohnehin ab – die
// Prüfung hier verhindert nur den unnötigen Upload-Versuch).
export async function uploadProductPhoto(file) {
  if (!isAdmin()) throw new Error("Nur Admins dürfen Fotos hochladen.");
  if (!file || !file.type.startsWith("image/")) {
    throw new Error("Bitte eine Bilddatei auswählen.");
  }
  const blob = await resizeToJpeg(file);
  const path = `produkte/${crypto.randomUUID()}.jpg`;
  const client = getSupabaseClient();
  const { error } = await client.storage.from(BUCKET).upload(path, blob, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

export async function deleteProductPhoto(path) {
  if (!path) return;
  if (!isAdmin()) throw new Error("Nur Admins dürfen Fotos löschen.");
  const client = getSupabaseClient();
  const { error } = await client.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message);
  urlCache.delete(path);
}

// Löst image_path zu einer anzeigbaren, signierten URL auf (oder null, wenn
// kein Pfad, offline oder die Signierung fehlschlägt – der Aufrufer zeigt in
// dem Fall den Platzhalter statt eines kaputten Bild-Icons).
export async function resolveImageUrl(path) {
  if (!path) return null;
  const cached = urlCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null;
  try {
    const client = getSupabaseClient();
    const { data, error } = await client.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) return null;
    urlCache.set(path, {
      url: data.signedUrl,
      // Sicherheitsabstand zur echten Ablauffrist, damit ein Bild nicht
      // mitten in der Anzeige ungültig wird.
      expiresAt: Date.now() + (SIGNED_URL_TTL_SECONDS - 60) * 1000,
    });
    return data.signedUrl;
  } catch {
    return null;
  }
}
