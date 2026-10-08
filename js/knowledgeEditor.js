import { can, getCurrentProfile } from "./auth.js";
import { loadKnowledge, saveKnowledge } from "./storage.js";
import { uploadKnowledgePhoto, deleteKnowledgePhoto, resolveImageUrl } from "./photos.js";
import { onLanguageChanged, t } from "./i18n.js";

// Wissen pflegen – Editor für Schulungsartikel (Paket 55).
//
// Der Editor hält den Zustand in einem Objekt (`state`) und zeichnet nur die
// Zeilenlisten (Abschnitte, Quellen) neu; die festen Felder liegen in
// index.html. Alles Nutzerseitige geht per value/textContent hinein, nie als
// HTML (Regel 5).
//
// Titelbild: Hochgeladen wird erst beim Speichern. Schlägt das Speichern
// fehl, wird das neue Bild wieder gelöscht; ist es gelungen, wird das alte
// gelöscht. So bleibt in keinem Fall eine verwaiste Datei liegen.
//
// Die Qualitätsregel (Veröffentlichen nur mit Quelle und Prüfvermerk) prüft
// zuerst das Formular mit verständlicher Meldung; verbindlich ist der
// CHECK-Constraint in der Datenbank.

const formEl = document.getElementById("knowledge-editor");
const headingEl = document.getElementById("knowledge-ed-heading");
const titleEl = document.getElementById("knowledge-ed-title");
const categoryEl = document.getElementById("knowledge-ed-category");
const summaryEl = document.getElementById("knowledge-ed-summary");
const departmentsEl = document.getElementById("knowledge-ed-departments");
const berufeEl = document.getElementById("knowledge-ed-berufe");
const jahrEl = document.getElementById("knowledge-ed-jahr");
const levelEl = document.getElementById("knowledge-ed-level");
const tagsEl = document.getElementById("knowledge-ed-tags");
const lernkarteInfoEl = document.getElementById("knowledge-ed-lernkarte-info");
const sectionsEl = document.getElementById("knowledge-ed-sections");
const sourcesEl = document.getElementById("knowledge-ed-sources");
const reviewedAtEl = document.getElementById("knowledge-ed-reviewed-at");
const reviewedByEl = document.getElementById("knowledge-ed-reviewed-by");
const publishedEl = document.getElementById("knowledge-ed-published");
const errorEl = document.getElementById("knowledge-ed-error");
const saveBtn = document.getElementById("knowledge-ed-save");
const cancelBtn = document.getElementById("knowledge-ed-cancel");
const photoPreviewEl = document.getElementById("knowledge-ed-photo-preview");
const photoInputEl = document.getElementById("knowledge-ed-photo-input");
const photoRemoveBtn = document.getElementById("knowledge-ed-photo-remove");

// Erlaubte Werte spiegeln die CHECK-Constraints von knowledge_articles.
const JAHRE = [1, 2, 3];
const LEVELS = ["basis", "aufbau", "fortgeschritten", "experte"];

let options = { categories: [], getDepartments: () => [], berufe: [], safeHttpUrl: () => null, onClose: () => {} };
let state = null; // null = Editor zu
let baseline = "";
let previewObjectUrl = null;
let saving = false;

// ---------------------------------------------------------------------
// Zustand
// ---------------------------------------------------------------------

function todayIso() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function currentUserName() {
  const profile = getCurrentProfile();
  return profile?.display_name || profile?.username || "";
}

function emptyState() {
  return {
    id: null,
    title: "",
    category: options.categories[0] ?? "",
    summary: "",
    departments: [],
    berufe: [],
    jahr: "", // "" = keine Angabe, sonst "1".."3" (wie im <select>)
    level: "",
    tagsText: "",
    lernfeld: [],
    pruefung: [],
    sections: [{ heading: "", text: "" }],
    sources: [],
    reviewedAt: todayIso(),
    reviewedBy: currentUserName(),
    published: false,
    sort: 0,
    imagePath: null, // gespeicherter Pfad
    newPhoto: null, // gewählte, noch nicht hochgeladene Datei
    photoRemoved: false,
  };
}

function stateFromArticle(article) {
  return {
    id: article.id,
    title: article.title,
    category: article.category,
    summary: article.summary,
    departments: [...article.departments],
    berufe: [...(article.berufe ?? [])],
    jahr: article.jahr ? String(article.jahr) : "",
    level: article.level ?? "",
    tagsText: (article.tags ?? []).join(", "),
    lernfeld: [...(article.lernfeld ?? [])],
    pruefung: [...(article.pruefung ?? [])],
    sections: article.sections.map((s) => ({ heading: s?.heading ?? "", text: s?.text ?? "" })),
    sources: article.sources.map((s) => ({ label: s?.label ?? "", url: s?.url ?? "", note: s?.note ?? "" })),
    // Ein Entwurf ohne Prüfvermerk bekommt heute + eigenes Konto vorbelegt.
    reviewedAt: article.reviewedAt ?? todayIso(),
    reviewedBy: article.reviewedBy || currentUserName(),
    published: article.published,
    sort: article.sort,
    imagePath: article.imagePath,
    newPhoto: null,
    photoRemoved: false,
  };
}

// Vergleichsstand für "ungespeicherte Änderungen".
function snapshot() {
  if (!state) return "";
  return JSON.stringify({ ...state, newPhoto: state.newPhoto ? state.newPhoto.name + state.newPhoto.size : null });
}

export function isKnowledgeEditorOpen() {
  return state !== null;
}

export function isKnowledgeEditorDirty() {
  return state !== null && snapshot() !== baseline;
}

// Fragt nach, bevor ungespeicherte Änderungen verworfen werden.
export function confirmDiscardKnowledgeEdits() {
  return !isKnowledgeEditorDirty() || confirm(t("ui.wissen_ed_verwerfen"));
}

// ---------------------------------------------------------------------
// Darstellung
// ---------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function showError(message) {
  errorEl.textContent = message || "";
  errorEl.hidden = !message;
  if (message) errorEl.scrollIntoView?.({ block: "nearest" });
}

function renderCategories() {
  const known = options.categories;
  const list = state.category && !known.includes(state.category) ? [...known, state.category] : known;
  categoryEl.textContent = "";
  list.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    categoryEl.appendChild(option);
  });
  categoryEl.value = state.category;
}

function renderDepartments() {
  departmentsEl.textContent = "";
  options.getDepartments().forEach((department) => {
    const label = el("label", "knowledge-ed-check");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = department.key;
    box.checked = state.departments.includes(department.key);
    label.append(box, el("span", null, department.label));
    departmentsEl.appendChild(label);
  });
  // Abteilungen, die der Artikel trägt, die es aber (noch) nicht in der Liste
  // gibt, dürfen beim Speichern nicht still verschwinden.
  const listed = new Set(options.getDepartments().map((d) => d.key));
  state.departments
    .filter((key) => !listed.has(key))
    .forEach((key) => {
      const label = el("label", "knowledge-ed-check");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = key;
      box.checked = true;
      label.append(box, el("span", null, key));
      departmentsEl.appendChild(label);
    });
}

function checkbox(container, key, label, checked) {
  const row = el("label", "knowledge-ed-check");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.value = key;
  box.checked = checked;
  row.append(box, el("span", null, label));
  container.appendChild(row);
}

function renderBerufe() {
  berufeEl.textContent = "";
  options.berufe.forEach((beruf) => checkbox(berufeEl, beruf.key, beruf.label, state.berufe.includes(beruf.key)));
  // Wie bei den Abteilungen: unbekannte Schlüssel nicht still verlieren.
  const listed = new Set(options.berufe.map((b) => b.key));
  state.berufe.filter((key) => !listed.has(key)).forEach((key) => checkbox(berufeEl, key, key, true));
}

function fillSelect(selectEl, entries, value) {
  selectEl.textContent = "";
  entries.forEach(([optionValue, label]) => {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = label;
    selectEl.appendChild(option);
  });
  selectEl.value = value;
}

function renderLernkarte() {
  renderBerufe();
  fillSelect(
    jahrEl,
    [["", t("ui.wissen_ed_keine_angabe")], ...JAHRE.map((n) => [String(n), t("ui.wissen_jahr_n", { n })])],
    state.jahr
  );
  fillSelect(
    levelEl,
    [["", t("ui.wissen_ed_keine_angabe")], ...LEVELS.map((l) => [l, t(`ui.wissen_level_${l}`)])],
    state.level
  );
  tagsEl.value = state.tagsText;
  // Lernfeld und Prüfung kommen aus dem SQL-Import und sind hier nur zu sehen.
  const info = [];
  if (state.lernfeld.length) info.push(t("ui.wissen_ed_lernfeld", { list: state.lernfeld.join(", ") }));
  if (state.pruefung.length) info.push(t("ui.wissen_ed_pruefung", { list: state.pruefung.join(", ") }));
  lernkarteInfoEl.textContent = info.join(" · ");
  lernkarteInfoEl.hidden = info.length === 0;
}

function iconButton(iconClass, labelKey, onClick, disabled = false) {
  const button = el("button", "btn-secondary knowledge-ed-icon-btn");
  button.type = "button";
  button.disabled = disabled;
  button.title = t(labelKey);
  button.setAttribute("aria-label", t(labelKey));
  const icon = el("i", `ph ${iconClass}`);
  icon.setAttribute("aria-hidden", "true");
  button.appendChild(icon);
  button.addEventListener("click", onClick);
  return button;
}

function move(list, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
}

function textField(labelKey, value, onInput, { multiline = false, maxLength } = {}) {
  const label = el("label", null, t(labelKey));
  const input = multiline ? document.createElement("textarea") : document.createElement("input");
  if (multiline) input.rows = 5;
  else input.type = "text";
  if (maxLength) input.maxLength = maxLength;
  input.value = value;
  input.addEventListener("input", () => onInput(input.value));
  label.appendChild(input);
  return label;
}

function renderSections() {
  sectionsEl.textContent = "";
  state.sections.forEach((section, index) => {
    const row = el("div", "knowledge-ed-row");
    const head = el("div", "knowledge-ed-row-head");
    head.appendChild(el("strong", null, t("ui.wissen_ed_abschnitt_nr", { nr: index + 1 })));
    const tools = el("div", "knowledge-ed-row-tools");
    tools.append(
      iconButton("ph-arrow-up", "ui.nach_oben", () => {
        move(state.sections, index, -1);
        renderSections();
      }, index === 0),
      iconButton("ph-arrow-down", "ui.nach_unten", () => {
        move(state.sections, index, 1);
        renderSections();
      }, index === state.sections.length - 1),
      iconButton("ph-trash", "ui.entfernen", () => {
        state.sections.splice(index, 1);
        renderSections();
      })
    );
    head.appendChild(tools);
    row.append(
      head,
      textField("ui.wissen_ed_ueberschrift", section.heading, (v) => (section.heading = v), { maxLength: 200 }),
      textField("ui.wissen_ed_text", section.text, (v) => (section.text = v), { multiline: true })
    );
    sectionsEl.appendChild(row);
  });
}

function renderSources() {
  sourcesEl.textContent = "";
  state.sources.forEach((source, index) => {
    const row = el("div", "knowledge-ed-row");
    const head = el("div", "knowledge-ed-row-head");
    head.appendChild(el("strong", null, t("ui.wissen_ed_quelle_nr", { nr: index + 1 })));
    const tools = el("div", "knowledge-ed-row-tools");
    tools.append(
      iconButton("ph-arrow-up", "ui.nach_oben", () => {
        move(state.sources, index, -1);
        renderSources();
      }, index === 0),
      iconButton("ph-arrow-down", "ui.nach_unten", () => {
        move(state.sources, index, 1);
        renderSources();
      }, index === state.sources.length - 1),
      iconButton("ph-trash", "ui.entfernen", () => {
        state.sources.splice(index, 1);
        renderSources();
      })
    );
    head.appendChild(tools);
    row.append(
      head,
      textField("ui.wissen_ed_quelle_bezeichnung", source.label, (v) => (source.label = v), { maxLength: 300 }),
      textField("ui.wissen_ed_quelle_link", source.url, (v) => (source.url = v), { maxLength: 1000 }),
      textField("ui.wissen_ed_quelle_hinweis", source.note, (v) => (source.note = v), { maxLength: 300 })
    );
    sourcesEl.appendChild(row);
  });
}

function releasePreview() {
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = null;
}

function showPhotoPlaceholder() {
  photoPreviewEl.textContent = "";
  const icon = el("i", "ph ph-image");
  icon.setAttribute("aria-hidden", "true");
  photoPreviewEl.appendChild(icon);
}

function showPhoto(url) {
  photoPreviewEl.textContent = "";
  const img = document.createElement("img");
  img.alt = "";
  img.src = url;
  photoPreviewEl.appendChild(img);
}

async function renderPhoto() {
  releasePreview();
  photoRemoveBtn.hidden = !state.newPhoto && (state.photoRemoved || !state.imagePath);
  if (state.newPhoto) {
    previewObjectUrl = URL.createObjectURL(state.newPhoto);
    showPhoto(previewObjectUrl);
    return;
  }
  showPhotoPlaceholder();
  if (state.photoRemoved || !state.imagePath) return;
  const path = state.imagePath;
  const url = await resolveImageUrl(path);
  // Zwischenzeitlich könnte das Bild ersetzt oder der Editor geschlossen sein.
  if (url && state && state.imagePath === path && !state.newPhoto && !state.photoRemoved) showPhoto(url);
}

function renderAll() {
  headingEl.textContent = state.id ? t("ui.wissen_ed_artikel_bearbeiten") : t("ui.wissen_neuer_artikel");
  titleEl.value = state.title;
  summaryEl.value = state.summary;
  reviewedAtEl.value = state.reviewedAt ?? "";
  reviewedByEl.value = state.reviewedBy;
  publishedEl.checked = state.published;
  renderCategories();
  renderDepartments();
  renderLernkarte();
  renderSections();
  renderSources();
  renderPhoto();
}

// ---------------------------------------------------------------------
// Öffnen / Schließen
// ---------------------------------------------------------------------

// article = null legt einen neuen Artikel an.
export function openKnowledgeEditor(article) {
  if (!can("knowledge.write")) return false;
  state = article ? stateFromArticle(article) : emptyState();
  showError("");
  renderAll();
  baseline = snapshot();
  formEl.hidden = false;
  formEl.scrollIntoView?.({ block: "start" });
  return true;
}

function closeEditor(savedId) {
  releasePreview();
  state = null;
  baseline = "";
  formEl.hidden = true;
  options.onClose(savedId ?? null);
}

// Schließt den Editor ohne onClose (der Aufrufer navigiert selbst).
export function discardKnowledgeEditor() {
  releasePreview();
  state = null;
  baseline = "";
  formEl.hidden = true;
}

// ---------------------------------------------------------------------
// Prüfen und Speichern
// ---------------------------------------------------------------------

function cleanedSections() {
  return state.sections
    .map((s) => ({ heading: s.heading.trim(), text: s.text.replace(/\r\n?/g, "\n").trim() }))
    .filter((s) => s.heading || s.text);
}

// Kommagetrennt → Liste ohne Leereinträge und ohne Dubletten (Groß-/Kleinschreibung egal).
function parsedTags() {
  const seen = new Set();
  return state.tagsText
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// Liefert { sources } oder { error }.
function cleanedSources() {
  const sources = [];
  for (const [index, source] of state.sources.entries()) {
    const label = source.label.trim();
    const url = source.url.trim();
    const note = source.note.trim();
    if (!label && !url && !note) continue;
    if (!label) return { error: t("ui.wissen_ed_fehler_quelle_bezeichnung", { nr: index + 1 }) };
    if (url && !options.safeHttpUrl(url)) return { error: t("ui.wissen_ed_fehler_quelle_link", { nr: index + 1 }) };
    const entry = { label };
    if (url) entry.url = options.safeHttpUrl(url);
    if (note) entry.note = note;
    sources.push(entry);
  }
  return { sources };
}

function validate() {
  const title = state.title.trim();
  if (!title) return { error: t("ui.wissen_ed_fehler_titel") };
  const duplicate = loadKnowledge().some(
    (a) => a.id !== state.id && a.title.trim().toLowerCase() === title.toLowerCase()
  );
  if (duplicate) return { error: t("ui.wissen_ed_fehler_titel_doppelt") };
  if (!state.category.trim()) return { error: t("ui.wissen_ed_fehler_kategorie") };

  const { sources, error } = cleanedSources();
  if (error) return { error };

  const reviewedBy = state.reviewedBy.trim();
  const reviewedAt = state.reviewedAt || null;
  if (state.published) {
    if (sources.length === 0) return { error: t("ui.wissen_ed_fehler_quelle_noetig") };
    if (!reviewedAt || !reviewedBy) return { error: t("ui.wissen_ed_fehler_pruefvermerk_noetig") };
  }
  return {
    article: {
      id: state.id,
      title,
      category: state.category.trim(),
      summary: state.summary.trim(),
      sections: cleanedSections(),
      departments: state.departments,
      berufe: state.berufe,
      jahr: state.jahr ? Number(state.jahr) : null,
      level: state.level || null,
      tags: parsedTags(),
      sort: state.sort,
      sources,
      reviewedAt,
      reviewedBy,
      published: state.published,
    },
  };
}

async function submit(event) {
  event.preventDefault();
  if (saving || !state) return;
  showError("");
  if (!can("knowledge.write")) {
    showError(t("ui.wissen_ed_kein_recht"));
    return;
  }
  const { article, error } = validate();
  if (error) {
    showError(error);
    return;
  }

  saving = true;
  saveBtn.disabled = true;
  let uploadedPath = null;
  try {
    // Bild zuerst: schlägt der Upload fehl, ist noch nichts gespeichert.
    let imagePath = state.photoRemoved ? null : state.imagePath;
    if (state.newPhoto) {
      uploadedPath = await uploadKnowledgePhoto(state.newPhoto);
      imagePath = uploadedPath;
    }
    let saved;
    try {
      saved = await saveKnowledge({ ...article, imagePath });
    } catch (saveError) {
      // Das neue Bild gehört zu keinem Artikel → nicht liegen lassen.
      if (uploadedPath) await deleteKnowledgePhoto(uploadedPath).catch(() => {});
      throw saveError;
    }
    // Altes Bild erst nach erfolgreichem Speichern entfernen.
    if (state.imagePath && state.imagePath !== imagePath) {
      await deleteKnowledgePhoto(state.imagePath).catch(() => {});
    }
    closeEditor(saved.id);
  } catch (e) {
    showError(describeError(e));
  } finally {
    saving = false;
    saveBtn.disabled = false;
  }
}

function describeError(error) {
  if (error?.code === "23505") return t("ui.wissen_ed_fehler_titel_doppelt");
  if (error?.code === "23514") return t("ui.wissen_ed_fehler_veroeffentlichen_db");
  return `${t("ui.wissen_ed_fehler_speichern")} ${error?.message ?? ""}`.trim();
}

function cancel() {
  if (saving) return;
  if (!confirmDiscardKnowledgeEdits()) return;
  closeEditor(null);
}

// ---------------------------------------------------------------------
// Verdrahtung
// ---------------------------------------------------------------------

// options: { categories, getDepartments(), berufe: [{ key, label }], safeHttpUrl(url), onClose(savedId|null) }
export function initKnowledgeEditor(opts) {
  if (!formEl) return;
  options = { ...options, ...opts };

  formEl.addEventListener("submit", submit);
  cancelBtn.addEventListener("click", cancel);

  titleEl.addEventListener("input", () => (state.title = titleEl.value));
  summaryEl.addEventListener("input", () => (state.summary = summaryEl.value));
  categoryEl.addEventListener("change", () => (state.category = categoryEl.value));
  reviewedAtEl.addEventListener("input", () => (state.reviewedAt = reviewedAtEl.value));
  reviewedByEl.addEventListener("input", () => (state.reviewedBy = reviewedByEl.value));
  publishedEl.addEventListener("change", () => (state.published = publishedEl.checked));
  departmentsEl.addEventListener("change", () => {
    state.departments = [...departmentsEl.querySelectorAll("input:checked")].map((box) => box.value);
  });

  berufeEl.addEventListener("change", () => {
    state.berufe = [...berufeEl.querySelectorAll("input:checked")].map((box) => box.value);
  });
  jahrEl.addEventListener("change", () => (state.jahr = jahrEl.value));
  levelEl.addEventListener("change", () => (state.level = levelEl.value));
  tagsEl.addEventListener("input", () => (state.tagsText = tagsEl.value));

  document.getElementById("knowledge-ed-add-section").addEventListener("click", () => {
    state.sections.push({ heading: "", text: "" });
    renderSections();
    sectionsEl.lastElementChild?.querySelector("input")?.focus();
  });
  document.getElementById("knowledge-ed-add-source").addEventListener("click", () => {
    state.sources.push({ label: "", url: "", note: "" });
    renderSources();
    sourcesEl.lastElementChild?.querySelector("input")?.focus();
  });

  photoInputEl.addEventListener("change", () => {
    const file = photoInputEl.files?.[0];
    if (!file) return;
    state.newPhoto = file;
    state.photoRemoved = false;
    photoInputEl.value = "";
    renderPhoto();
  });
  photoRemoveBtn.addEventListener("click", () => {
    state.newPhoto = null;
    state.photoRemoved = true;
    photoInputEl.value = "";
    renderPhoto();
  });

  // Ungespeicherte Änderungen nicht beim Schließen des Tabs verlieren.
  window.addEventListener("beforeunload", (e) => {
    if (isKnowledgeEditorDirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // Sprachwechsel: Beschriftungen der Zeilen neu bauen, Eingaben bleiben im Zustand.
  onLanguageChanged(() => {
    if (!state) return;
    headingEl.textContent = state.id ? t("ui.wissen_ed_artikel_bearbeiten") : t("ui.wissen_neuer_artikel");
    renderLernkarte();
    renderSections();
    renderSources();
  });
}
