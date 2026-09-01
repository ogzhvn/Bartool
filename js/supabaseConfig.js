// Supabase-Projekteinstellungen.
//
// Zu finden im Supabase-Dashboard unter Project Settings → API:
// - SUPABASE_URL: "Project URL"
// - SUPABASE_ANON_KEY: "anon public" Key
//
// Der anon-Key ist öffentlich und darf im Frontend-Code stehen – er erlaubt
// für sich genommen keinen Datenzugriff. Was ein eingeloggter Nutzer lesen
// oder schreiben darf, wird ausschließlich serverseitig über Row Level
// Security geregelt (siehe supabase/schema.sql). Niemals den
// "service_role"-Key hier eintragen oder ins Repo committen.
export const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
export const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";
