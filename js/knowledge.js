import { getSupabaseClient } from "./supabaseClient.js";
import { myDepartment } from "./auth.js";
import { loadKnowledge, loadKnowledgeReads, markKnowledgeRead, onKnowledgeChanged } from "./storage.js";
import { resolveImageUrl } from "./photos.js";
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
// Titel, Texte, Quellen und Prüfvermerk sind Nutzereingaben. Alles wird
// deshalb per DOM-Erzeugung und textContent gesetzt, nie als HTML.

// Feste Kategorien in Anzeigereihenfolge. Die Namen bleiben deutsch
// (Fachinhalt, Regel 11). Kategorien, die nur in den Daten vorkommen,
// hängen hinten an.
export const KNOWLEDGE_CATEGORIES = [
  "Produktwissen",
  "Service & Abläufe",
  "Getränkekunde",
  "Hygiene & Sicherheit",
  "Haus & Outlets",
  "Sonstiges",
];

const FILTER_OWN = "own";
const FILTER_ALL = "all";

const searchEl = document.getElementById("knowledge-search");
const departmentEl = document.getElementById("knowledge-department");
const unreadEl = document.getElementById("knowledge-unread");
const chipsEl = document.getElementById("knowledge-categories");
const listEl = document.getElementById("knowledge-list");
const listViewEl = document.getElementById("knowledge-list-view");
const detailEl = document.getElementById("knowledge-detail");

let departments = [];
let activeCategory = "";
let departmentFilter = null;
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

function sortedArticles() {
  return [...loadKnowledge()].sort(
    (a, b) => a.sort - b.sort || a.title.localeCompare(b.title, "de", { sensitivity: "base" })
  );
}

function matchesDepartment(article) {
  if (departmentFilter === FILTER_ALL) return true;
  if (article.departments.length === 0) return true;
  const key = departmentFilter === FILTER_OWN ? myDepartment() : departmentFilter;
  return key ? article.departments.includes(key) : true;
}

function matchesSearch(article, query) {
  if (!query) return true;
  const parts = [article.title, article.summary, article.category];
  article.sections.forEach((section) => {
    parts.push(section?.heading ?? "", section?.text ?? "");
  });
  return parts.join("\n").toLowerCase().includes(query);
}

function visibleArticles() {
  const query = searchEl.value.trim().toLowerCase();
  const onlyUnread = unreadEl.checked;
  return sortedArticles().filter((article) => {
    if (activeCategory && article.category !== activeCategory) return false;
    if (!matchesDepartment(article)) return false;
    if (!matchesSearch(article, query)) return false;
    if (onlyUnread && !["neu", "aktualisiert"].includes(readState(article))) return false;
    return true;
  });
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

// Text eines Abschnitts: Leerzeile = Absatz, Zeilen mit "- " = Listenpunkte.
// Gibt neutrale Blöcke zurück, damit Detailansicht und Druck dasselbe lesen.
export function parseSectionText(text) {
  const blocks = [];
  String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .forEach((chunk) => {
      let paragraph = [];
      let items = [];
      const flush = () => {
        if (paragraph.length) blocks.push({ type: "p", text: paragraph.join("\n") });
        if (items.length) blocks.push({ type: "ul", items });
        paragraph = [];
        items = [];
      };
      chunk.split("\n").forEach((line) => {
        if (line.startsWith("- ")) {
          if (paragraph.length) flush();
          const item = line.slice(2).trim();
          if (item) items.push(item);
        } else if (line.trim()) {
          if (items.length) flush();
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

function renderChips() {
  const present = new Set(loadKnowledge().map((a) => a.category));
  const categories = [
    ...KNOWLEDGE_CATEGORIES.filter((c) => present.has(c)),
    ...[...present].filter((c) => c && !KNOWLEDGE_CATEGORIES.includes(c)).sort(),
  ];
  if (activeCategory && !categories.includes(activeCategory)) activeCategory = "";
  chipsEl.textContent = "";
  chipsEl.hidden = categories.length === 0;
  [["", t("ui.alle")], ...categories.map((c) => [c, c])].forEach(([value, label]) => {
    const chip = el("button", "quiz-lb-chip", label);
    chip.type = "button";
    chip.dataset.category = value;
    chip.classList.toggle("active", value === activeCategory);
    chip.setAttribute("aria-pressed", String(value === activeCategory));
    chipsEl.appendChild(chip);
  });
}

function renderCard(article) {
  const card = el("button", "knowledge-card");
  card.type = "button";
  card.dataset.id = article.id;
  const head = el("div", "knowledge-card-head");
  head.append(el("span", "knowledge-card-category", article.category), statusBadge(article));
  card.append(head, el("h3", "knowledge-card-title", article.title));
  if (article.summary) card.appendChild(el("p", "knowledge-card-summary", article.summary));
  return card;
}

function renderList() {
  const all = loadKnowledge();
  const shown = visibleArticles();
  listEl.textContent = "";
  if (shown.length === 0) {
    listEl.appendChild(
      el("p", "empty-note", all.length === 0 ? t("ui.wissen_leer") : t("ui.wissen_keine_treffer"))
    );
    return;
  }
  shown.forEach((article) => listEl.appendChild(renderCard(article)));
}

// ---------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------

function renderSection(section) {
  const wrap = el("section", "knowledge-section");
  if (section?.heading) wrap.appendChild(el("h4", null, section.heading));
  parseSectionText(section?.text).forEach((block) => {
    if (block.type === "ul") {
      const ul = el("ul");
      block.items.forEach((item) => ul.appendChild(el("li", null, item)));
      wrap.appendChild(ul);
    } else {
      wrap.appendChild(el("p", "knowledge-text", block.text));
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

function renderDetail(article) {
  const token = ++detailRenderToken;
  detailEl.textContent = "";

  const toolbar = el("div", "knowledge-toolbar");
  const back = el("button", "btn-secondary", t("ui.wissen_zurueck"));
  back.type = "button";
  back.dataset.action = "back";
  const print = el("button", "btn-secondary", t("ui.drucken"));
  print.type = "button";
  print.dataset.action = "print";
  toolbar.append(back, print);
  detailEl.appendChild(toolbar);

  const meta = el("div", "knowledge-card-head");
  meta.append(el("span", "knowledge-card-category", article.category), statusBadge(article));
  detailEl.append(meta, el("h3", "knowledge-detail-title", article.title));
  detailEl.appendChild(el("p", "hint", departmentsText(article)));

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

  if (article.summary) detailEl.appendChild(el("p", "knowledge-summary", article.summary));
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

function showList() {
  openArticleId = null;
  statusMessage = "";
  detailRenderToken += 1;
  detailEl.hidden = true;
  listViewEl.hidden = false;
}

function openArticle(id) {
  const article = loadKnowledge().find((a) => a.id === id);
  if (!article) return;
  openArticleId = id;
  statusMessage = "";
  listViewEl.hidden = true;
  detailEl.hidden = false;
  renderDetail(article);
  detailEl.scrollIntoView?.({ block: "start" });
}

// ---------------------------------------------------------------------
// Zusammenspiel
// ---------------------------------------------------------------------

function render() {
  renderDepartmentFilter();
  renderChips();
  renderList();
  if (openArticleId) {
    const article = loadKnowledge().find((a) => a.id === openArticleId);
    if (article) renderDetail(article);
    else showList();
  }
}

// Daten- oder Statuswechsel (Realtime, Gelesen-Haken): nur neu zeichnen,
// Filter und offenen Artikel behalten.
function refresh() {
  renderChips();
  renderList();
  if (openArticleId) {
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

export function initKnowledge() {
  if (!listEl) return;

  searchEl.addEventListener("input", renderList);
  unreadEl.addEventListener("change", renderList);
  departmentEl.addEventListener("change", () => {
    departmentFilter = departmentEl.value;
    renderList();
  });
  chipsEl.addEventListener("click", (e) => {
    const chip = e.target.closest(".quiz-lb-chip");
    if (!chip) return;
    activeCategory = chip.dataset.category;
    renderChips();
    renderList();
  });
  listEl.addEventListener("click", (e) => {
    const card = e.target.closest(".knowledge-card");
    if (card) openArticle(card.dataset.id);
  });
  detailEl.addEventListener("click", (e) => {
    const button = e.target.closest("button[data-action]");
    if (!button) return;
    if (button.dataset.action === "back") showList();
    else if (button.dataset.action === "read") handleMarkRead();
    else if (button.dataset.action === "print") {
      const article = loadKnowledge().find((a) => a.id === openArticleId);
      if (article) {
        printKnowledge({
          title: article.title,
          category: article.category,
          departmentsText: departmentsText(article),
          summary: article.summary,
          sections: article.sections.map((s) => ({ heading: s?.heading ?? "", blocks: parseSectionText(s?.text) })),
          stand:
            article.reviewedAt && article.reviewedBy
              ? t("ui.wissen_stand", { date: formatDate(article.reviewedAt), name: article.reviewedBy })
              : "",
          sourcesTitle: t("ui.wissen_quellen"),
          sources: article.sources.map((src) =>
            [src?.label, src?.url, src?.note].filter(Boolean).join(" – ")
          ),
        });
      }
    }
  });

  onKnowledgeChanged(refresh);
  onLanguageChanged(render);
  render();
  loadDepartments().then(() => {
    renderDepartmentFilter();
    renderList();
  });
}
