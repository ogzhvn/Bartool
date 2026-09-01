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
export const SUPABASE_URL = "https://hwahjjihajgajcnzngwv.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3YWhqamloYWpnYWpjbnpuZ3d2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyNjkwMDksImV4cCI6MjEwMzg0NTAwOX0.pKTTxPNt5z3cC9y-8uXGNIiLy4OTO0Fl5ns7dwG6WQg";
