import { t } from "./i18n.js";
// Produkt- und Rezeptfotos: Verkleinerung im Browser, Upload/Löschen im
// privaten Storage-Bucket "bilder" und Auflösen von image_path zu einer
// signierten, zeitlich begrenzten URL. Der Bucket ist bewusst nicht
// öffentlich (Paket 30, Entscheidung vom 09.09.2026) – ohne Login ist ein
// Bild auch mit bekannter URL nicht abrufbar.
//
// Pfadschema: produkte/<uuid>.jpg für Produktfotos, rezepte/<uuid>.jpg für
// Rezeptfotos (Paket 31, Aufbau- und Garniturbild teilen sich den Ordner),
// wissen/<uuid>.jpg für das Titelbild eines Wissensartikels (Paket 55).
// PNG- und WebP-Vorlagen (z. B. freigestellte Flaschen) landen als .webp,
// damit die Transparenz erhalten bleibt.
// Nie der Name im Pfad, sonst bricht jede Umbenennung das Bild.
import { getSupabaseClient } from "./supabaseClient.js";
import { can } from "./auth.js";

const BUCKET = "bilder";
const MAX_EDGE_PX = 1200;
const JPEG_QUALITY = 0.8;
const WEBP_QUALITY = 0.85;
// Eingabeformate mit möglichem Alphakanal. JPEG würde transparente Flächen
// schwarz füllen, deshalb werden sie als WebP (mit Alpha) gespeichert.
const ALPHA_TYPES = new Set(["image/png", "image/webp"]);
const SIGNED_URL_TTL_SECONDS = 3600;

// path -> { url, expiresAt }. Signierte URLs pro Session cachen, statt bei
// jeder Anzeige neu zu signieren.
const urlCache = new Map();

function resizeImage(file, outputType, quality) {
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
        (blob) => (blob ? resolve(blob) : reject(new Error(t("ui.bild_konnte_nicht_verkleinert_werden")))),
        outputType,
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(t("ui.datei_ist_kein_lesbares_bild")));
    };
    img.src = objectUrl;
  });
}

// Welches Recht ein Bild braucht, entscheidet der Ordner: Produktfotos
// hängen an products.write, Rezeptfotos an recipes.write, Wissensbilder an
// knowledge.write. Genauso steht es in den Storage-Policies (Paket 36/53) –
// hier wird nur derselbe Schnitt gespiegelt.
function fotoRecht(folderOrPath) {
  const folder = String(folderOrPath).split("/")[0];
  if (folder === "rezepte") return "recipes.write";
  if (folder === "wissen") return "knowledge.write";
  return "products.write";
}

// Lädt ein Handyfoto verkleinert in den angegebenen Ordner hoch und gibt den
// neuen image_path zurück. Wirft, wenn das Schreibrecht fehlt (Policy lehnt
// es serverseitig ohnehin ab – die Prüfung hier verhindert nur den unnötigen
// Upload-Versuch).
async function uploadPhoto(file, folder) {
  if (!can(fotoRecht(folder))) throw new Error(t("ui.kein_recht_fotos_hochzuladen"));
  if (!file || !file.type.startsWith("image/")) {
    throw new Error(t("ui.bitte_eine_bilddatei_auswaehlen"));
  }
  const keepAlpha = ALPHA_TYPES.has(file.type);
  const outputType = keepAlpha ? "image/webp" : "image/jpeg";
  const blob = await resizeImage(file, outputType, keepAlpha ? WEBP_QUALITY : JPEG_QUALITY);
  // Browser ohne WebP-Encoder liefern stillschweigend PNG – Endung und
  // contentType richten sich deshalb nach dem tatsächlichen Blob.
  const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const client = getSupabaseClient();
  const { error } = await client.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type || outputType,
    upsert: false,
  });
  if (error) throw new Error(error.message);
  return path;
}

async function deletePhoto(path) {
  if (!path) return;
  if (!can(fotoRecht(path))) throw new Error(t("ui.kein_recht_fotos_zu_loeschen"));
  const client = getSupabaseClient();
  const { error } = await client.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(error.message);
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

export function uploadKnowledgePhoto(file) {
  return uploadPhoto(file, "wissen");
}

export function deleteKnowledgePhoto(path) {
  return deletePhoto(path);
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
