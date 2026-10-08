import { getSupabaseClient } from "./supabaseClient.js";
import { can, myDepartment } from "./auth.js";
import {
  deleteKnowledge,
  loadKnowledge,
  loadKnowledgeReads,
  markKnowledgeRead,
  onKnowledgeChanged,
} from "./storage.js";
import { deleteKnowledgePhoto, resolveImageUrl } from "./photos.js";
import { switchTab } from "./tabs.js";
import {
  confirmDiscardKnowledgeEdits,
  discardKnowledgeEditor,
  initKnowledgeEditor,
  isKnowledgeEditorOpen,
  openKnowledgeEditor,
} from "./knowledgeEditor.js";
import { printKnowledge } from "./printView.js";
import { formatDate, onLanguageChanged, t } from "./i18n.js";

// Wissen – Schulungsartikel für alle Outlets (Paket 54).
//
// Liste mit Filtern, Detailansicht und Gelesen-Status. Gelesen wird pro
// Konto in knowledge_reads geführt (js/storage.js); steht updated_at des
// Artikels hinter read_at, gilt er als "Aktualisiert seit dem Lesen".
//
// Der Abteilungsfilter ist Kosmetik, kein Zugriffsschutz: lesen dürfen alle
// angemeldeten Konten (RLS), Entwürfe nur mit knowledge.write.
//
// Pflege (Paket 55): Anlegen, Bearbeiten, Veröffentlichen und Löschen steckt in
// js/knowledgeEditor.js und hängt an knowledge.write.
//
// Titel, Texte, Quellen und Prüfvermerk sind Nutzereingaben. Alles wird
// deshalb per DOM-Erzeugung und textContent gesetzt, nie als HTML.

// Feste Kategorien in Anzeigereihenfolge. Die Namen bleiben deutsch
// (Fachinhalt, Regel 11). Bereinigte, überschneidungsfreie Liste (Paket 61):
// die Kategorien des Lernkarten-Themenkatalogs (Paket 56, Reihenfolge laut
// Themenliste) plus ein paar noch leere Fachkategorien. Die älteren
// Startkategorien („Service & Abläufe“, „Hygiene & Sicherheit“, „Haus &
// Outlets“) sowie die Dubletten „Wein & Schaumwein“, „Spirituosen“,
// „Getränkekunde“ und „Produktwissen“ sind entfernt. „Sonstiges“ bleibt, bis
// der Testartikel daraus gelöscht ist. Kategorien, die nur in den Daten
// vorkommen, hängen hinten an.
export const KNOWLEDGE_CATEGORIES = [
  "Gastgeberrolle & Kommunikation",
  "Serviceablauf & Servierarten",
  "Gastraum, Mise en place & Eindecken",
  "Speisen- & Menükunde",
  "Ernährungsformen, Allergene & Kennzeichnung",
  "Alkoholfreie Getränke",
  "Kaffee & Tee",
  "Bier",
  "Warenkunde Wein",
  "Warenkunde Spirituosen",
  "Bar & Mixology",
  "Warenwirtschaft & Lager",
  "Kalkulation, Kasse & Zahlung",
  "Hygiene & Lebensmittelrecht",
  "Arbeitssicherheit, Gesundheit & Nachhaltigkeit",
  "Recht & Betriebsorganisation",
  "Veranstaltungen & Bankett",
  "Team, Führung & Ausbildung",
  "Sonstiges",
];

// Ausbildungsberufe der Lernkarten (Spalte berufe). Amtliche Bezeichnungen,
// deshalb wie die Kategorien nur deutsch.
export const KNOWLEDGE_BERUFE = [
  { key: "fg", label: "Fachkraft für Gastronomie" },
  { key: "frv", label: "Fachmann/-frau für Restaurants und Veranstaltungsgastronomie" },
  { key: "hofa", label: "Hotelfachmann/-frau" },
];
const KNOWLEDGE_JAHRE = [1, 2, 3];
const KNOWLEDGE_LEVELS = ["basis", "aufbau", "fortgeschritten", "experte"];

const FILTER_OWN = "own";
const FILTER_ALL = "all";

const searchEl = document.getElementById("knowledge-search");
const departmentEl = document.getElementById("knowledge-department");
const unreadEl = document.getElementById("knowledge-unread");
const jahrEl = document.getElementById("knowledge-jahr");
const levelEl = document.getElementById("knowledge-level");
const filterToggleEl = document.getElementById("knowledge-filter-toggle");
const filterCountEl = document.getElementById("knowledge-filter-count");
const filterPanelEl = document.getElementById("knowledge-filter-panel");
const filterResetEl = document.getElementById("knowledge-filter-reset");
const navEl = document.getElementById("knowledge-nav");
const topicsEl = document.getElementById("knowledge-topics");
const listEl = document.getElementById("knowledge-list");
const listViewEl = document.getElementById("knowledge-list-view");
const detailEl = document.getElementById("knowledge-detail");
const newBtn = document.getElementById("knowledge-new");

let departments = [];
// Ansicht (Paket 62): ohne Suche und Kategorie die Themenübersicht, mit
// Kategorie deren Liste, mit Suchtext die Treffer aus allen Kategorien.
let activeCategory = "";
// Scrollposition der Liste beim Öffnen eines Artikels, für "Zurück".
let listScrollTop = null;
let departmentFilter = null;
// "" = alle. Jahr als String, wie es aus dem <select> kommt.
let jahrFilter = "";
let levelFilter = "";
let openArticleId = null;
let statusMessage = "";
let detailRenderToken = 0;

// ---------------------------------------------------------------------
// Daten
// ---------------------------------------------------------------------

async function loadDepartments() {
  try {
    const { data, error } = await getSupabaseClient()
      .from("departments")
      .select("key, label, sort")
      .order("sort", { ascending: true });
    if (!error && Array.isArray(data)) departments = data;
  } catch {
    // Offline oder nicht lesbar: Schlüssel dienen als Beschriftung.
  }
}

function departmentLabel(key) {
  return departments.find((d) => d.key === key)?.label ?? key;
}

// "neu" | "gelesen" | "aktualisiert" | null (Entwurf: kein Status).
function readState(article) {
  if (!article.published) return null;
  const readAt = loadKnowledgeReads().get(article.id);
  if (!readAt) return "neu";
  const read = new Date(readAt).getTime();
  const updated = new Date(article.updatedAt).getTime();
  if (Number.isFinite(read) && Number.isFinite(updated) && updated > read) return "aktualisiert";
  return "gelesen";
}

// Rang einer Kategorie: feste Reihenfolge, unbekannte dahinter.
function categoryRank(category) {
  const index = KNOWLEDGE_CATEGORIES.indexOf(category);
  return index === -1 ? KNOWLEDGE_CATEGORIES.length : index;
}

function sortedArticles() {
  return [...loadKnowledge()].sort(
    (a, b) =>
      categoryRank(a.category) - categoryRank(b.category) ||
      (categoryRank(a.category) === KNOWLEDGE_CATEGORIES.length &&
        a.category.localeCompare(b.category, "de", { sensitivity: "base" })) ||
      a.sort - b.sort ||
      a.title.localeCompare(b.title, "de", { sensitivity: "base" })
  );
}

function matchesDepartment(article) {
  if (departmentFilter === FILTER_ALL) return true;
  if (article.departments.length === 0) return true;
  const key = departmentFilter === FILTER_OWN ? myDepartment() : departmentFilter;
  return key ? article.departments.includes(key) : true;
}

// Jahr und Level
// zählen nur, wo sie gesetzt sind: bei aktivem Filter fallen Artikel ohne
// Angabe heraus.
function matchesMeta(article) {
  if (jahrFilter && article.jahr !== Number(jahrFilter)) return false;
  if (levelFilter && article.level !== levelFilter) return false;
  return true;
}

function matchesSearch(article, query) {
  if (!query) return true;
  const parts = [article.title, article.summary, article.category, ...(article.tags ?? [])];
  article.sections.forEach((section) => {
    parts.push(section?.heading ?? "", section?.text ?? "");
  });
  return parts.join("\n").toLowerCase().includes(query);
}

function searchQuery() {
  return searchEl.value.trim().toLowerCase();
}

const isUnread = (article) => ["neu", "aktualisiert"].includes(readState(article));

// Abteilung, Jahr, Level; Entwürfe nur mit knowledge.write (RLS liefert sie
// ohnehin nur dann, das hier ist die zweite Sicherung).
function filteredArticles() {
  const drafts = can("knowledge.write");
  return sortedArticles().filter(
    (article) => (article.published || drafts) && matchesDepartment(article) && matchesMeta(article)
  );
}

// Liste der aktuellen Ansicht: Suche über alle Kategorien, sonst die
// gewählte Kategorie.
function visibleArticles() {
  const query = searchQuery();
  const onlyUnread = unreadEl.checked;
  return filteredArticles().filter((article) => {
    if (!query && article.category !== activeCategory) return false;
    if (!matchesSearch(article, query)) return false;
    if (onlyUnread && !isUnread(article)) return false;
    return true;
  });
}

function defaultDepartmentFilter() {
  return myDepartment() ? FILTER_OWN : FILTER_ALL;
}

function activeFilterCount() {
  return [
    departmentFilter !== null && departmentFilter !== defaultDepartmentFilter(),
    jahrFilter !== "",
    levelFilter !== "",
    unreadEl.checked,
  ].filter(Boolean).length;
}

// ---------------------------------------------------------------------
// Hilfen zum Bauen von DOM
// ---------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function statusBadge(article) {
  if (!article.published) return el("span", "knowledge-badge knowledge-badge-draft", t("ui.wissen_status_entwurf"));
  const state = readState(article);
  if (state === "neu") return el("span", "knowledge-badge knowledge-badge-new", t("ui.neu"));
  if (state === "aktualisiert") {
    return el("span", "knowledge-badge knowledge-badge-updated", t("ui.wissen_status_aktualisiert"));
  }
  const badge = el("span", "knowledge-badge knowledge-badge-read");
  const icon = el("i", "ph ph-check-circle");
  icon.setAttribute("aria-hidden", "true");
  badge.append(icon, document.createTextNode(t("ui.wissen_status_gelesen")));
  return badge;
}

// Nur http(s) wird zum Link; alles andere (javascript:, data:, ungültig)
// bleibt reiner Text.
export function safeHttpUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

// Inline-Auszeichnung: **fett** und *kursiv*. Liefert Segmente
// ({ text, bold?, italic? }) statt HTML, damit Detailansicht und Druck den
// Text nie als Markup einsetzen. Öffnendes Zeichen direkt vor, schließendes
// direkt nach Text (kein Leerzeichen) – "5 * 3" bleibt dadurch Text.
const INLINE_RE = /\*\*(\S(?:[\s\S]*?\S)?)\*\*|\*([^\s*](?:[^*]*[^\s*])?)\*/g;

export function parseInline(text) {
  const source = String(text ?? "");
  const segments = [];
  let last = 0;
  for (const m of source.matchAll(INLINE_RE)) {
    if (m.index > last) segments.push({ text: source.slice(last, m.index) });
    if (m[1] !== undefined) {
      parseInline(m[1]).forEach((seg) => segments.push({ ...seg, bold: true }));
    } else {
      segments.push({ text: m[2], italic: true });
    }
    last = m.index + m[0].length;
  }
  if (last < source.length) segments.push({ text: source.slice(last) });
  return segments;
}

const OL_RE = /^(\d{1,3})\. +(.*)$/;

function tableCells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

const isSeparatorRow = (cells) => cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));

function buildTable(rawRows) {
  const hasHeader = rawRows.length >= 2 && isSeparatorRow(rawRows[1]);
  const header = hasHeader ? rawRows[0] : null;
  const body = rawRows.slice(hasHeader ? 2 : 0).filter((cells) => !isSeparatorRow(cells));
  const columns = Math.max(header?.length ?? 0, ...body.map((r) => r.length));
  const toCells = (cells) =>
    Array.from({ length: columns }, (_, i) => parseInline(cells[i] ?? ""));
  return { type: "table", header: header && toCells(header), rows: body.map(toCells) };
}

// Text eines Abschnitts: Leerzeile = Absatz. Zeilen mit "- " = Listenpunkte,
// "1. " = nummerierte Liste, Zeilen mit "|" am Anfang = Tabelle (Kopfzeile,
// Trennzeile "|---|---|", Datenzeilen). Gibt neutrale Blöcke zurück, damit
// Detailansicht und Druck dasselbe lesen; Inline-Text steht als Segmente
// (siehe parseInline) in den Blöcken:
//   { type: "p", inline } | { type: "ul", items } | { type: "ol", start, items }
//   | { type: "table", header | null, rows }
// Nicht unterstützt: Überschriften, Links, Code, verschachtelte Listen.
export function parseSectionText(text) {
  const blocks = [];
  String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .forEach((chunk) => {
      let paragraph = [];
      let items = [];
      let ordered = [];
      let orderedStart = 1;
      let tableRows = [];
      const flush = () => {
        if (paragraph.length) blocks.push({ type: "p", inline: parseInline(paragraph.join("\n")) });
        if (items.length) blocks.push({ type: "ul", items: items.map(parseInline) });
        if (ordered.length) {
          blocks.push({ type: "ol", start: orderedStart, items: ordered.map(parseInline) });
        }
        if (tableRows.length) blocks.push(buildTable(tableRows));
        paragraph = [];
        items = [];
        ordered = [];
        tableRows = [];
      };
      chunk.split("\n").forEach((line) => {
        const numbered = OL_RE.exec(line);
        if (line.startsWith("- ")) {
          if (!items.length) flush();
          const item = line.slice(2).trim();
          if (item) items.push(item);
        } else if (numbered) {
          if (!ordered.length) {
            flush();
            orderedStart = Number(numbered[1]);
          }
          if (numbered[2].trim()) ordered.push(numbered[2].trim());
        } else if (line.trim().startsWith("|")) {
          if (!tableRows.length) flush();
          tableRows.push(tableCells(line));
        } else if (line.trim()) {
          if (!paragraph.length) flush();
          paragraph.push(line.trim());
        }
      });
      flush();
    });
  return blocks;
}

function departmentsText(article) {
  return article.departments.length === 0
    ? t("ui.wissen_gilt_fuer_alle")
    : t("ui.wissen_gilt_fuer", { list: article.departments.map(departmentLabel).join(", ") });
}

function berufLabel(key) {
  return KNOWLEDGE_BERUFE.find((b) => b.key === key)?.label ?? key;
}

function iconEl(name) {
  const icon = el("i", `ph ${name}`);
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

// Metadaten des Detailkopfs als kleine Tags: Abteilungen, Berufe, Jahr, Level.
function metaTags(article) {
  const list = el("ul", "knowledge-tags");
  const add = (icon, text, title) => {
    const tag = el("li", "knowledge-tag");
    tag.append(iconEl(icon), document.createTextNode(text));
    if (title) tag.title = title;
    list.appendChild(tag);
  };
  const abteilung = t("ui.wissen_abteilung");
  if (article.departments.length === 0) add("ph-buildings", t("ui.wissen_abt_alle"), abteilung);
  else article.departments.forEach((key) => add("ph-buildings", departmentLabel(key), abteilung));
  (article.berufe ?? []).forEach((key) => add("ph-student", berufLabel(key)));
  if (article.jahr) add("ph-calendar-blank", t("ui.wissen_jahr_n", { n: article.jahr }));
  if (article.level) add("ph-chart-bar", t(`ui.wissen_level_${article.level}`), t("ui.wissen_level"));
  return list;
}

// Lernkarten wiederholen die Kurzfassung als ersten Satz des ersten
// Abschnitts; dann wird sie nicht doppelt gezeigt.
export function summaryRepeated(article) {
  const summary = (article.summary ?? "").trim();
  const first = String(article.sections?.[0]?.text ?? "").trim();
  return summary !== "" && first.startsWith(summary);
}

// ---------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------

function renderDepartmentFilter() {
  const previous = departmentFilter;
  departmentEl.textContent = "";
  const own = myDepartment();
  const options = [];
  if (own) options.push([FILTER_OWN, t("ui.wissen_abt_eigene")]);
  options.push([FILTER_ALL, t("ui.wissen_abt_alle")]);
  departments.forEach((d) => options.push([d.key, d.label]));
  options.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    departmentEl.appendChild(option);
  });
  // Standard = eigene Abteilung + "alle"; ohne Abteilung gibt es nichts zu filtern.
  const wanted = previous ?? (own ? FILTER_OWN : FILTER_ALL);
  departmentFilter = options.some(([value]) => value === wanted) ? wanted : FILTER_ALL;
  departmentEl.value = departmentFilter;
}

function fillSelect(selectEl, options, value) {
  selectEl.textContent = "";
  options.forEach(([optionValue, label]) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    selectEl.appendChild(option);
  });
  selectEl.value = value;
}

function renderMetaFilters() {
  fillSelect(
    jahrEl,
    [["", t("ui.wissen_jahr_alle")], ...KNOWLEDGE_JAHRE.map((n) => [String(n), t("ui.wissen_jahr_n", { n })])],
    jahrFilter
  );
  fillSelect(
    levelEl,
    [["", t("ui.wissen_level_alle")], ...KNOWLEDGE_LEVELS.map((l) => [l, t(`ui.wissen_level_${l}`)])],
    levelFilter
  );
}

// Kategorien mit Artikeln: feste Reihenfolge, unbekannte alphabetisch dahinter.
function presentCategories(articles) {
  const present = new Set(articles.map((a) => a.category).filter(Boolean));
  return [
    ...KNOWLEDGE_CATEGORIES.filter((c) => present.has(c)),
    ...[...present]
      .filter((c) => !KNOWLEDGE_CATEGORIES.includes(c))
      .sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" })),
  ];
}

// Themenübersicht: eine Kachel je Kategorie mit Anzahl und Lesefortschritt.
// Die Filter wirken mit; "Nur ungelesen" blendet fertig gelesene Themen aus.
function renderTopics() {
  const all = loadKnowledge();
  const articles = filteredArticles();
  const onlyUnread = unreadEl.checked;
  topicsEl.textContent = "";
  presentCategories(articles).forEach((category) => {
    const inCategory = articles.filter((a) => a.category === category);
    const published = inCategory.filter((a) => a.published);
    const read = published.filter((a) => readState(a) === "gelesen").length;
    if (onlyUnread && !published.some(isUnread)) return;

    const tile = el("button", "knowledge-topic");
    tile.type = "button";
    tile.dataset.category = category;
    const count = [
      inCategory.length === 1 ? t("ui.wissen_artikel_eins") : t("ui.wissen_artikel_n", { n: inCategory.length }),
    ];
    const drafts = inCategory.length - published.length;
    if (drafts > 0) count.push(t("ui.wissen_entwuerfe_n", { n: drafts }));
    tile.append(
      el("span", "knowledge-topic-name", category),
      el("span", "knowledge-topic-count", count.join(" · "))
    );
    if (published.length > 0) {
      const bar = el("span", "knowledge-progress");
      bar.setAttribute("aria-hidden", "true");
      const fill = el("span", "knowledge-progress-fill");
      fill.style.width = `${Math.round((read / published.length) * 100)}%`;
      bar.appendChild(fill);
      tile.append(
        bar,
        el("span", "knowledge-topic-progress", t("ui.wissen_gelesen_von", { read, total: published.length }))
      );
      tile.classList.toggle("done", read === published.length);
    }
    topicsEl.appendChild(tile);
  });
  if (!topicsEl.firstChild) {
    topicsEl.appendChild(
      el("p", "empty-note", all.length === 0 ? t("ui.wissen_leer") : t("ui.wissen_keine_treffer"))
    );
  }
}

function backButton(action, label, ariaLabel) {
  const button = el("button", "knowledge-back-link");
  button.type = "button";
  button.dataset.action = action;
  button.setAttribute("aria-label", ariaLabel);
  button.append(iconEl("ph-arrow-left"), el("span", null, label));
  return button;
}

// Kopf über der Liste: "Alle Themen" + Kategoriename bzw. Trefferzahl.
function renderNav(mode, count) {
  navEl.textContent = "";
  navEl.hidden = mode === "overview";
  if (mode === "search") {
    const text = count === 1 ? t("ui.wissen_treffer_eins") : t("ui.wissen_treffer_n", { n: count });
    navEl.appendChild(el("p", "knowledge-nav-title", text));
    return;
  }
  if (mode !== "category") return;
  const label = t("ui.wissen_alle_themen");
  navEl.appendChild(backButton("overview", label, label));
  const title = el("h3", "knowledge-nav-title", activeCategory);
  title.appendChild(el("span", "knowledge-nav-count", ` · ${count}`));
  navEl.appendChild(title);
}

function statusBadgeShort(article) {
  const badge = statusBadge(article);
  if (readState(article) === "aktualisiert") {
    badge.title = badge.textContent;
    badge.textContent = t("ui.wissen_status_aktualisiert_kurz");
  }
  return badge;
}

// Kompakte Zeile: Titel, Level (bei Suche auch Kategorie), Status,
// Kurztext höchstens zwei Zeilen (am Handy ausgeblendet, CSS).
function renderRow(article, withCategory) {
  const row = el("button", "knowledge-row");
  row.type = "button";
  row.dataset.id = article.id;
  const main = el("span", "knowledge-row-main");
  main.appendChild(el("span", "knowledge-row-title", article.title));
  const meta = [];
  if (withCategory) meta.push(article.category);
  if (article.level) meta.push(t(`ui.wissen_level_${article.level}`));
  if (meta.length) main.appendChild(el("span", "knowledge-row-meta", meta.join(" · ")));
  if (article.summary) main.appendChild(el("span", "knowledge-row-summary", article.summary));
  row.append(main, statusBadgeShort(article), iconEl("ph-caret-right knowledge-row-caret"));
  return row;
}

function renderFilterState() {
  const count = activeFilterCount();
  filterCountEl.hidden = count === 0;
  filterCountEl.textContent = String(count);
  filterToggleEl.classList.toggle("active", count > 0);
  if (count > 0) filterToggleEl.setAttribute("aria-label", t("ui.wissen_filter_n", { n: count }));
  else filterToggleEl.removeAttribute("aria-label");
  filterResetEl.disabled = count === 0;
}

function currentMode() {
  if (searchQuery()) return "search";
  return activeCategory ? "category" : "overview";
}

function renderBrowse() {
  // Kategorie verschwunden (gelöscht/umbenannt): zurück zur Übersicht.
  if (activeCategory && !loadKnowledge().some((a) => a.category === activeCategory)) activeCategory = "";
  const mode = currentMode();
  renderFilterState();
  topicsEl.hidden = mode !== "overview";
  listEl.hidden = mode === "overview";
  listEl.textContent = "";
  topicsEl.textContent = "";
  if (mode === "overview") {
    renderNav(mode, 0);
    renderTopics();
    return;
  }
  const shown = visibleArticles();
  renderNav(mode, shown.length);
  if (shown.length === 0) {
    listEl.appendChild(
      el("p", "empty-note", loadKnowledge().length === 0 ? t("ui.wissen_leer") : t("ui.wissen_keine_treffer"))
    );
    return;
  }
  shown.forEach((article) => listEl.appendChild(renderRow(article, mode === "search")));
}

function resetFilters() {
  departmentFilter = defaultDepartmentFilter();
  departmentEl.value = departmentFilter;
  jahrFilter = "";
  levelFilter = "";
  jahrEl.value = "";
  levelEl.value = "";
  unreadEl.checked = false;
  renderBrowse();
}

function setFiltersOpen(open) {
  filterPanelEl.hidden = !open;
  filterToggleEl.setAttribute("aria-expanded", String(open));
}

// ---------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------

// Segmente (parseInline) als Text-/<strong>-/<em>-Knoten – nie als HTML.
function appendInline(node, segments) {
  segments.forEach((seg) => {
    let child = document.createTextNode(seg.text);
    if (seg.italic) {
      const em = document.createElement("em");
      em.appendChild(child);
      child = em;
    }
    if (seg.bold) {
      const strong = document.createElement("strong");
      strong.appendChild(child);
      child = strong;
    }
    node.appendChild(child);
  });
}

function inlineEl(tag, className, segments) {
  const node = el(tag, className);
  appendInline(node, segments);
  return node;
}

function renderTable(block) {
  const wrap = el("div", "knowledge-table-wrap");
  wrap.tabIndex = 0;
  const table = el("table", "knowledge-table");
  if (block.header) {
    const tr = el("tr");
    block.header.forEach((cell) => {
      const th = inlineEl("th", null, cell);
      th.scope = "col";
      tr.appendChild(th);
    });
    table.appendChild(el("thead")).appendChild(tr);
  }
  const tbody = el("tbody");
  block.rows.forEach((row) => {
    const tr = el("tr");
    row.forEach((cell) => tr.appendChild(inlineEl("td", null, cell)));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function renderSection(section) {
  const wrap = el("section", "knowledge-section");
  if (section?.heading) wrap.appendChild(el("h4", null, section.heading));
  parseSectionText(section?.text).forEach((block) => {
    if (block.type === "ul" || block.type === "ol") {
      const list = el(block.type);
      if (block.type === "ol" && block.start !== 1) list.start = block.start;
      block.items.forEach((item) => list.appendChild(inlineEl("li", null, item)));
      wrap.appendChild(list);
    } else if (block.type === "table") {
      wrap.appendChild(renderTable(block));
    } else {
      wrap.appendChild(inlineEl("p", "knowledge-text", block.inline));
    }
  });
  return wrap;
}

function renderSources(article) {
  const wrap = el("div", "knowledge-sources");
  wrap.appendChild(el("h4", null, t("ui.wissen_quellen")));
  const ul = el("ul");
  article.sources.forEach((source) => {
    const li = document.createElement("li");
    const href = safeHttpUrl(source?.url);
    if (href) {
      const link = el("a", null, source.label);
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      li.appendChild(link);
    } else {
      li.appendChild(document.createTextNode(source?.label ?? ""));
    }
    if (source?.note) li.appendChild(el("span", "knowledge-source-note", ` – ${source.note}`));
    ul.appendChild(li);
  });
  wrap.appendChild(ul);
  return wrap;
}

function readButtonLabel(article) {
  const state = readState(article);
  if (state === "gelesen") {
    return t("ui.wissen_gelesen_am", { date: formatDate(loadKnowledgeReads().get(article.id)) });
  }
  return state === "aktualisiert" ? t("ui.wissen_erneut_gelesen") : t("ui.wissen_als_gelesen");
}

function iconButton(action, icon, label) {
  const button = el("button", "btn-secondary btn-icon");
  button.type = "button";
  button.dataset.action = action;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.appendChild(iconEl(icon));
  return button;
}

// Wohin "Zurück" führt: Suchtreffer, Kategorie oder Übersicht.
function backLabel() {
  if (searchQuery()) return t("ui.wissen_suchergebnisse");
  return activeCategory || t("ui.wissen_alle_themen");
}

// Kopfzeile: Zurück links, Drucken/Bearbeiten als Symbolknöpfe rechts,
// Löschen nur im Überlaufmenü.
function renderDetailBar() {
  const bar = el("div", "knowledge-detail-bar");
  const label = backLabel();
  bar.appendChild(backButton("back", label, `${t("ui.wissen_zurueck")}: ${label}`));
  const tools = el("div", "knowledge-detail-tools");
  tools.appendChild(iconButton("print", "ph-printer", t("ui.drucken")));
  if (can("knowledge.write")) {
    const edit = iconButton("edit", "ph-pencil-simple", t("ui.bearbeiten"));
    edit.dataset.perm = "knowledge.write";
    const more = el("div", "knowledge-more");
    more.dataset.perm = "knowledge.write";
    const moreBtn = iconButton("more", "ph-dots-three-vertical", t("ui.wissen_weitere_aktionen"));
    moreBtn.setAttribute("aria-haspopup", "true");
    moreBtn.setAttribute("aria-expanded", "false");
    moreBtn.setAttribute("aria-controls", "knowledge-more-menu");
    const menu = el("div", "knowledge-more-menu");
    menu.id = "knowledge-more-menu";
    menu.hidden = true;
    const remove = el("button", "knowledge-more-item knowledge-delete");
    remove.type = "button";
    remove.dataset.action = "delete";
    remove.append(iconEl("ph-trash"), document.createTextNode(t("ui.loeschen")));
    menu.appendChild(remove);
    more.append(moreBtn, menu);
    tools.append(edit, more);
  }
  bar.appendChild(tools);
  return bar;
}

function setMoreMenuOpen(open) {
  const menu = detailEl.querySelector(".knowledge-more-menu");
  const button = detailEl.querySelector('button[data-action="more"]');
  if (!menu || !button) return;
  menu.hidden = !open;
  button.setAttribute("aria-expanded", String(open));
}

function renderDetail(article) {
  const token = ++detailRenderToken;
  detailEl.textContent = "";
  detailEl.appendChild(renderDetailBar());

  const meta = el("div", "knowledge-card-head");
  meta.append(el("span", "knowledge-card-category", article.category), statusBadge(article));
  detailEl.append(meta, el("h3", "knowledge-detail-title", article.title), metaTags(article));

  if (article.imagePath) {
    const img = el("img", "knowledge-cover");
    img.alt = article.title;
    img.hidden = true;
    detailEl.appendChild(img);
    resolveImageUrl(article.imagePath).then((url) => {
      if (url && token === detailRenderToken) {
        img.src = url;
        img.hidden = false;
      }
    });
  }

  if (article.summary && !summaryRepeated(article)) {
    detailEl.appendChild(el("p", "knowledge-summary", article.summary));
  }
  article.sections.forEach((section) => detailEl.appendChild(renderSection(section)));

  const footer = el("div", "knowledge-footer");
  footer.appendChild(
    el(
      "p",
      "hint",
      article.reviewedAt && article.reviewedBy
        ? t("ui.wissen_stand", { date: formatDate(article.reviewedAt), name: article.reviewedBy })
        : t("ui.wissen_nicht_geprueft")
    )
  );
  detailEl.appendChild(footer);
  if (article.sources.length > 0) detailEl.appendChild(renderSources(article));

  if (article.published) {
    const state = readState(article);
    const mark = el("button", "btn-primary", readButtonLabel(article));
    mark.type = "button";
    mark.dataset.action = "read";
    mark.disabled = state === "gelesen";
    detailEl.appendChild(mark);
  }
  const status = el("p", "error-note", statusMessage);
  status.id = "knowledge-status";
  status.hidden = !statusMessage;
  status.setAttribute("role", "alert");
  detailEl.appendChild(status);
}

// Zurück in die Liste, aus der der Artikel geöffnet wurde, an dieselbe
// Scrollposition.
function showList() {
  openArticleId = null;
  statusMessage = "";
  detailRenderToken += 1;
  detailEl.hidden = true;
  listViewEl.hidden = false;
  if (listScrollTop !== null) {
    const top = listScrollTop;
    requestAnimationFrame(() => window.scrollTo({ top }));
  }
  listScrollTop = null;
}

// Auf dem Weg in den Editor: Liste und Detail weg, offener Artikel bleibt
// gemerkt, damit "Abbrechen" dorthin zurückführt.
function hideForEditor() {
  detailRenderToken += 1;
  listViewEl.hidden = true;
  detailEl.hidden = true;
}

function startEditing(article) {
  if (!openKnowledgeEditor(article)) return;
  hideForEditor();
}

// Editor ist zu: bei Speichern den Artikel zeigen, sonst dorthin zurück, wo
// der Weg begann.
function handleEditorClosed(savedId) {
  if (savedId) {
    openArticle(savedId);
    return;
  }
  const article = openArticleId ? loadKnowledge().find((a) => a.id === openArticleId) : null;
  if (article) openArticle(article.id);
  else showList();
}

async function handleDelete() {
  const article = loadKnowledge().find((a) => a.id === openArticleId);
  if (!article || !can("knowledge.write")) return;
  if (!confirm(t("ui.wissen_loeschen_bestaetigen", { title: article.title }))) return;
  try {
    await deleteKnowledge(article.id);
  } catch (error) {
    statusMessage = error?.message || t("ui.wissen_loeschen_fehler");
    renderDetail(article);
    return;
  }
  // Der Artikel ist weg; das Titelbild gehört zu keinem mehr.
  if (article.imagePath) await deleteKnowledgePhoto(article.imagePath).catch(() => {});
  showList();
  render();
}

// deepLink: Sprung von außen (globale Suche, gespeicherter Artikel). Dann
// führt "Zurück" in die Kategorie des Artikels statt in eine alte Ansicht.
function openArticle(id, { deepLink = false } = {}) {
  const article = loadKnowledge().find((a) => a.id === id);
  if (!article) return;
  if (deepLink) {
    activeCategory = article.category;
    searchEl.value = "";
    listScrollTop = null;
    renderBrowse();
  } else if (!openArticleId && !listViewEl.hidden) {
    listScrollTop = window.scrollY;
  }
  openArticleId = id;
  statusMessage = "";
  listViewEl.hidden = true;
  detailEl.hidden = false;
  renderDetail(article);
  detailEl.scrollIntoView?.({ block: "start" });
}

// Sprung aus der globalen Suche: Tab wechseln, Artikel öffnen. Ungespeicherte
// Änderungen im Editor werden vorher bestätigt.
export function focusKnowledge(id) {
  if (isKnowledgeEditorOpen()) {
    if (!confirmDiscardKnowledgeEdits()) return;
    discardKnowledgeEditor();
  }
  switchTab("knowledge");
  openArticle(id, { deepLink: true });
}

// Erneuter Klick auf "Wissen", während Wissen schon offen ist: zurück zur
// Themenübersicht. Filter bleiben.
function goToOverview() {
  showList();
  listScrollTop = null;
  activeCategory = "";
  searchEl.value = "";
  renderBrowse();
}

// ---------------------------------------------------------------------
// Zusammenspiel
// ---------------------------------------------------------------------

// Sprachwechsel: alles neu beschriften. Kategorie, Suche, Filter und offener
// Artikel stehen in Modulvariablen bzw. Feldern und bleiben erhalten.
function render() {
  renderDepartmentFilter();
  renderMetaFilters();
  refresh();
}

// Daten- oder Statuswechsel (Realtime, Gelesen-Haken): nur neu zeichnen,
// Filter und offenen Artikel behalten.
function refresh() {
  renderBrowse();
  // Offenes Formular nicht durch Realtime/Sprachwechsel anfassen.
  if (openArticleId && !isKnowledgeEditorOpen()) {
    const article = loadKnowledge().find((a) => a.id === openArticleId);
    if (article) renderDetail(article);
    else showList();
  }
}

async function handleMarkRead() {
  if (!openArticleId) return;
  statusMessage = "";
  try {
    await markKnowledgeRead(openArticleId);
  } catch (error) {
    statusMessage = error?.message || t("ui.wissen_lesen_fehler");
    const article = loadKnowledge().find((a) => a.id === openArticleId);
    if (article) renderDetail(article);
  }
}

function handlePrint() {
  const article = loadKnowledge().find((a) => a.id === openArticleId);
  if (!article) return;
  printKnowledge({
    title: article.title,
    category: article.category,
    departmentsText: departmentsText(article),
    summary: summaryRepeated(article) ? "" : article.summary,
    sections: article.sections.map((s) => ({ heading: s?.heading ?? "", blocks: parseSectionText(s?.text) })),
    stand:
      article.reviewedAt && article.reviewedBy
        ? t("ui.wissen_stand", { date: formatDate(article.reviewedAt), name: article.reviewedBy })
        : "",
    sourcesTitle: t("ui.wissen_quellen"),
    sources: article.sources.map((src) => [src?.label, src?.url, src?.note].filter(Boolean).join(" – ")),
  });
}

export function initKnowledge() {
  if (!listEl) return;

  searchEl.addEventListener("input", renderBrowse);
  unreadEl.addEventListener("change", renderBrowse);
  departmentEl.addEventListener("change", () => {
    departmentFilter = departmentEl.value;
    renderBrowse();
  });
  jahrEl.addEventListener("change", () => {
    jahrFilter = jahrEl.value;
    renderBrowse();
  });
  levelEl.addEventListener("change", () => {
    levelFilter = levelEl.value;
    renderBrowse();
  });
  filterToggleEl.addEventListener("click", () => setFiltersOpen(filterPanelEl.hidden));
  filterResetEl.addEventListener("click", resetFilters);
  topicsEl.addEventListener("click", (e) => {
    const tile = e.target.closest(".knowledge-topic");
    if (!tile) return;
    activeCategory = tile.dataset.category;
    renderBrowse();
    if (navEl.getBoundingClientRect().top < 0) navEl.scrollIntoView?.({ block: "start" });
  });
  navEl.addEventListener("click", (e) => {
    if (!e.target.closest('button[data-action="overview"]')) return;
    activeCategory = "";
    renderBrowse();
  });
  listEl.addEventListener("click", (e) => {
    const row = e.target.closest(".knowledge-row");
    if (row) openArticle(row.dataset.id);
  });
  detailEl.addEventListener("click", (e) => {
    const button = e.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "more") {
      setMoreMenuOpen(button.getAttribute("aria-expanded") !== "true");
      return;
    }
    setMoreMenuOpen(false);
    if (action === "back") showList();
    else if (action === "read") handleMarkRead();
    else if (action === "edit") {
      const article = loadKnowledge().find((a) => a.id === openArticleId);
      if (article) startEditing(article);
    } else if (action === "delete") handleDelete();
    else if (action === "print") handlePrint();
  });
  // Überlaufmenü schließt bei Klick daneben und mit Escape.
  document.addEventListener("click", (e) => {
    if (!e.target.closest?.(".knowledge-more")) setMoreMenuOpen(false);
  });
  detailEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setMoreMenuOpen(false);
  });

  newBtn.addEventListener("click", () => startEditing(null));
  initKnowledgeEditor({
    categories: KNOWLEDGE_CATEGORIES,
    getDepartments: () => departments,
    berufe: KNOWLEDGE_BERUFE,
    safeHttpUrl,
    onClose: handleEditorClosed,
  });

  // "Wissen" anklicken (Sidebar-Button, Start-Kachel): aus einem anderen Tab
  // bleibt die Ansicht, wie sie war. Nur ein Klick, während Wissen schon
  // offen ist, führt zur Themenübersicht. Der Capture-Listener sieht den
  // Zustand vor dem Tabwechsel. Der Editor bleibt unberührt, damit
  // ungespeicherte Änderungen nicht verloren gehen.
  const panelEl = document.getElementById("knowledge");
  let wasActive = false;
  document.addEventListener(
    "click",
    (e) => {
      if (e.target.closest?.('[data-tab="knowledge"]')) wasActive = panelEl?.classList.contains("active") ?? false;
    },
    true
  );
  document.querySelectorAll('[data-tab="knowledge"]').forEach((el) => {
    el.addEventListener("click", () => {
      if (!wasActive || isKnowledgeEditorOpen()) return;
      goToOverview();
    });
  });

  onKnowledgeChanged(refresh);
  onLanguageChanged(render);
  render();
  loadDepartments().then(() => {
    renderDepartmentFilter();
    refresh();
  });
}
