import { t } from "./i18n.js";

// Rechtekatalog fürs Frontend (Paket 36).
//
// Die Schlüssel sind identisch zur DB-Tabelle "permissions" (Paket 35) – die
// Matrix im Adminbereich schreibt genau diese Werte nach "role_permissions",
// und dieselben Werte stehen in den Policies. Weicht hier ein Schlüssel ab,
// setzt die Oberfläche ein Häkchen, das die Datenbank nie liest.
//
// Die Labels kommen aus dem Frontend (t(), Schlüssel "perm.*"), weil sie
// Oberflächentexte sind. Rollen-Labels dagegen stehen in der DB und bleiben
// unübersetzt (Entscheidung aus Paket 33).
//
// "policy" sagt, wo das Recht durchgesetzt wird. Das ist keine Doku um der
// Doku willen: die Regel aus Paket 36 lautet, dass jedes Recht in der Matrix
// eine echte Durchsetzung hat. Die eine Ausnahme ist unten mit
// sichtbarkeitNur: true markiert und wird in der Matrix als solche angezeigt.

export const PERMISSION_GROUPS = [
  { key: "inhalte", labelKey: "perm.group.inhalte" },
  { key: "betrieb", labelKey: "perm.group.betrieb" },
  { key: "auswertung", labelKey: "perm.group.auswertung" },
  { key: "verwaltung", labelKey: "perm.group.verwaltung" },
];

export const PERMISSIONS = [
  // Inhalte
  { key: "recipes.write", group: "inhalte", sort: 10, policy: "recipes, storage/bilder (rezepte/)" },
  { key: "products.write", group: "inhalte", sort: 20, policy: "products, product_prices, storage/bilder (produkte/)" },
  { key: "requests.review", group: "inhalte", sort: 30, policy: "change_requests" },
  { key: "quiz.manage", group: "inhalte", sort: 40, policy: "quiz_questions, quiz_attempts" },
  // Betrieb
  { key: "inventory.manage", group: "betrieb", sort: 10, policy: "inventory_counts, inventory_items" },
  { key: "preparations.manage", group: "betrieb", sort: 20, policy: "preparations" },
  { key: "events.manage", group: "betrieb", sort: 30, policy: "events" },
  { key: "checklists.manage", group: "betrieb", sort: 40, policy: "checklist_templates, checklist_runs" },
  { key: "shiftlog.manage", group: "betrieb", sort: 50, policy: "shift_logs" },
  { key: "losses.manage", group: "betrieb", sort: 60, policy: "losses" },
  // Auswertung
  { key: "reports.view", group: "auswertung", sort: 10, policy: "quiz_team_overview(), quiz_topic_heatmap()" },
  { key: "audit.view", group: "auswertung", sort: 20, policy: "audit_log" },
  { key: "audit.restore", group: "auswertung", sort: 30, policy: "restore_row()" },
  // Verwaltung
  {
    key: "data.manage",
    group: "verwaltung",
    sort: 10,
    // Datenqualität ist eine reine Auswertung über Daten, die jedes
    // angemeldete Konto ohnehin lesen darf; der Excel-Import schreibt über
    // dieselbe Policy wie eine normale Produktbearbeitung. Es gibt also
    // nichts, was dieses Recht in der Datenbank zusätzlich verbieten könnte –
    // das steht so in der Matrix und wird nicht als Schutz verkauft.
    sichtbarkeitNur: true,
    policy: "products (über products.write)",
  },
  { key: "users.manage", group: "verwaltung", sort: 20, policy: "profiles (mit Rangfolge)" },
  { key: "roles.manage", group: "verwaltung", sort: 30, policy: "roles, permissions, role_permissions (mit Rangfolge)" },
];

// Rechte, die an der Rangfolge hängen und nicht nur am Häkchen: verwalten
// darf man nur Rollen und Konten unterhalb des eigenen Rangs.
export const RANK_BASED_PERMISSIONS = ["users.manage", "roles.manage"];

export function permissionLabel(key) {
  return t(`perm.${key}`);
}

export function permissionHint(key) {
  return t(`perm.hint.${key}`);
}

export function groupLabel(key) {
  const group = PERMISSION_GROUPS.find((g) => g.key === key);
  return group ? t(group.labelKey) : key;
}

// Rechte in Gruppenreihenfolge, innerhalb der Gruppe nach sort.
export function permissionsByGroup() {
  return PERMISSION_GROUPS.map((group) => ({
    ...group,
    permissions: PERMISSIONS.filter((p) => p.group === group.key).sort((a, b) => a.sort - b.sort),
  })).filter((group) => group.permissions.length > 0);
}

export function permissionKeys() {
  return PERMISSIONS.map((p) => p.key);
}
