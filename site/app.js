const capabilityLabels = {
  attachments: "Attachments",
  reasoning: "Reasoning",
  structured_output: "Structured output",
  tools: "Tools",
  web_search: "Web search",
};

const state = {
  models: [],
  filtered: [],
};

const elements = {
  activeModels: document.querySelector("#active-models"),
  capability: document.querySelector("#capability"),
  cloud: document.querySelector("#cloud"),
  cloudModels: document.querySelector("#cloud-models"),
  closeDialog: document.querySelector("#close-dialog"),
  dialog: document.querySelector("#model-dialog"),
  dialogContent: document.querySelector("#dialog-content"),
  dialogId: document.querySelector("#dialog-id"),
  dialogTitle: document.querySelector("#dialog-title"),
  emptyState: document.querySelector("#empty-state"),
  modelRows: document.querySelector("#model-rows"),
  openModels: document.querySelector("#open-models"),
  reset: document.querySelector("#reset"),
  resultCount: document.querySelector("#result-count"),
  results: document.querySelector(".results"),
  search: document.querySelector("#search"),
  sort: document.querySelector("#sort"),
  status: document.querySelector("#status"),
  totalModels: document.querySelector("#total-models"),
  type: document.querySelector("#type"),
  updatedAt: document.querySelector("#updated-at"),
  weights: document.querySelector("#weights"),
};

for (const control of [
  elements.search,
  elements.status,
  elements.type,
  elements.cloud,
  elements.capability,
  elements.weights,
  elements.sort,
]) {
  control.addEventListener("input", applyFilters);
}

elements.reset.addEventListener("click", () => {
  for (const control of [
    elements.search,
    elements.status,
    elements.type,
    elements.cloud,
    elements.capability,
    elements.weights,
  ]) control.value = "";
  elements.sort.value = "name";
  applyFilters();
  elements.search.focus();
});

elements.modelRows.addEventListener("click", event => {
  const button = event.target.closest("button[data-model-index]");
  if (button) openModel(Number(button.dataset.modelIndex));
});

elements.closeDialog.addEventListener("click", () => elements.dialog.close());
elements.dialog.addEventListener("click", event => {
  if (event.target === elements.dialog) elements.dialog.close();
});
elements.dialog.addEventListener("close", () => {
  history.replaceState(null, "", `${location.pathname}${location.search}`);
});

loadCatalog();

async function loadCatalog() {
  try {
    const response = await fetch("catalog.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
    const catalog = await response.json();
    state.models = Object.entries(catalog.models).map(([id, model]) => ({ id, ...model }));
    state.models.forEach((model, index) => { model.catalogIndex = index; });
    elements.updatedAt.textContent = `Updated ${formatDateTime(catalog.updated_at)}`;
    populateSelect(elements.status, uniqueValues(state.models, "status"));
    populateSelect(elements.type, uniqueValues(state.models, "type"));
    renderSummary();
    applyFilters();
    openHashModel();
  } catch (error) {
    elements.updatedAt.textContent = "Catalog unavailable";
    elements.resultCount.textContent = error instanceof Error ? error.message : String(error);
    elements.emptyState.hidden = false;
    elements.results.setAttribute("aria-busy", "false");
  }
}

function renderSummary() {
  elements.totalModels.textContent = formatNumber(state.models.length);
  elements.activeModels.textContent = formatNumber(
    state.models.filter(model => model.status === "active").length,
  );
  elements.openModels.textContent = formatNumber(
    state.models.filter(model => model.open_weights === true).length,
  );
  elements.cloudModels.textContent = formatNumber(
    state.models.filter(model => activeClouds(model).length >= 3).length,
  );
}

function applyFilters() {
  const query = elements.search.value.trim().toLocaleLowerCase();
  state.filtered = state.models.filter(model => {
    if (query && !searchText(model).includes(query)) return false;
    if (elements.status.value && model.status !== elements.status.value) return false;
    if (elements.type.value && model.type !== elements.type.value) return false;
    if (elements.cloud.value && !activeClouds(model).includes(elements.cloud.value)) return false;
    if (elements.capability.value && !hasCapability(model, elements.capability.value)) return false;
    if (elements.weights.value === "open" && model.open_weights !== true) return false;
    if (elements.weights.value === "closed" && model.open_weights !== false) return false;
    return true;
  });
  state.filtered.sort(sortModels(elements.sort.value));
  renderRows();
}

function renderRows() {
  elements.resultCount.textContent = `Showing ${formatNumber(state.filtered.length)} of ${formatNumber(state.models.length)} models`;
  elements.emptyState.hidden = state.filtered.length !== 0;
  elements.modelRows.replaceChildren(...state.filtered.map(modelRow));
  elements.results.setAttribute("aria-busy", "false");
}

function modelRow(model) {
  const row = document.createElement("tr");
  row.append(
    cell(modelIdentity(model)),
    cell(statusPill(model.status)),
    cell(text(formatContext(model.limits?.context))),
    cell(chipList(activeClouds(model).map(cloud => cloud.toUpperCase()))),
    cell(chipList(activeCapabilities(model).slice(0, 3))),
    cell(text(formatDate(model.last_updated))),
  );
  return row;
}

function modelIdentity(model) {
  const wrapper = document.createElement("div");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "model-button";
  button.dataset.modelIndex = String(model.catalogIndex);
  button.textContent = model.name;
  const id = document.createElement("p");
  id.className = "model-id";
  id.textContent = model.id;
  wrapper.append(button, id);
  return wrapper;
}

function statusPill(status) {
  const pill = document.createElement("span");
  pill.className = `pill ${status ?? ""}`;
  pill.textContent = status || "unknown";
  return pill;
}

function chipList(values) {
  if (!values.length) return text("—", "muted");
  const list = document.createElement("div");
  list.className = "chip-list";
  for (const value of values) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = value;
    list.append(chip);
  }
  return list;
}

function openModel(index) {
  const model = state.models[index];
  if (!model) return;
  elements.dialogId.textContent = model.id;
  elements.dialogTitle.textContent = model.name;
  elements.dialogContent.replaceChildren(
    paragraph(model.description || "No description is available."),
    detailsGrid(model),
    detailSection("Capabilities", activeCapabilities(model)),
    detailSection("Cloud availability", activeClouds(model).map(cloud => cloud.toUpperCase())),
    detailSection("Input modalities", model.modalities?.input ?? []),
    detailSection("Output modalities", model.modalities?.output ?? []),
    detailSection("Tasks", model.tasks ?? []),
    detailSection("Use cases", model.use_cases ?? []),
    detailSection("Aliases", model.aliases ?? []),
  );
  history.replaceState(null, "", `#${encodeURIComponent(model.id)}`);
  elements.dialog.showModal();
}

function detailsGrid(model) {
  const list = document.createElement("dl");
  list.className = "detail-grid";
  const entries = [
    ["Status", model.status || "Unknown"],
    ["Type", model.type || "Unknown"],
    ["Publisher", model.publisher || "Unknown"],
    ["Context", formatContext(model.limits?.context)],
    ["Released", formatDate(model.release_date)],
    ["Updated", formatDate(model.last_updated)],
  ];
  for (const [label, value] of entries) {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = label;
    description.textContent = value;
    item.append(term, description);
    list.append(item);
  }
  return list;
}

function detailSection(title, values) {
  const section = document.createElement("section");
  section.className = "detail-section";
  const heading = document.createElement("h3");
  heading.textContent = title;
  section.append(heading, values.length ? chipList(values) : paragraph("None listed."));
  return section;
}

function openHashModel() {
  if (!location.hash) return;
  const id = decodeURIComponent(location.hash.slice(1));
  const model = state.models.find(candidate => candidate.id === id);
  if (model) openModel(model.catalogIndex);
}

function activeCapabilities(model) {
  return Object.entries(capabilityLabels)
    .filter(([name]) => hasCapability(model, name))
    .map(([, label]) => label);
}

function hasCapability(model, name) {
  const value = model.capabilities?.[name];
  if (name === "reasoning") return value?.supported === true;
  return value === true;
}

function activeClouds(model) {
  return Object.entries(model.availability ?? {})
    .filter(([, availability]) => availability?.status !== "retired")
    .map(([cloud]) => cloud);
}

function searchText(model) {
  return [
    model.id,
    model.name,
    model.description,
    model.publisher,
    model.family,
    ...(model.aliases ?? []),
    ...(model.tasks ?? []),
    ...(model.use_cases ?? []),
  ].filter(Boolean).join(" ").toLocaleLowerCase();
}

function sortModels(sort) {
  if (sort === "context") {
    return (left, right) => (right.limits?.context ?? -1) - (left.limits?.context ?? -1);
  }
  if (sort === "release") {
    return (left, right) => compareDate(right.release_date, left.release_date);
  }
  if (sort === "updated") {
    return (left, right) => compareDate(right.last_updated, left.last_updated);
  }
  return (left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

function compareDate(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""));
}

function uniqueValues(models, field) {
  return [...new Set(models.map(model => model[field]).filter(Boolean))].sort();
}

function populateSelect(select, values) {
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = titleCase(value);
    select.append(option);
  }
}

function cell(content) {
  const element = document.createElement("td");
  element.append(content);
  return element;
}

function text(value, className = "") {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = value;
  return element;
}

function paragraph(value) {
  const element = document.createElement("p");
  element.textContent = value;
  return element;
}

function titleCase(value) {
  return value.replaceAll("_", " ").replace(/\b\w/g, character => character.toUpperCase());
}

function formatContext(value) {
  return typeof value === "number" ? `${formatNumber(value)} tokens` : "—";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf())) return String(value);
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return String(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value);
}
