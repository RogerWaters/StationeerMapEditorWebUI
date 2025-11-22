import { getContinentSettings, projectState, updateContinentSettings } from "../state/projectState.js";
import { buildContinentsPreviewJob, getContinentPreviewSize } from "../services/continentPreviewBuilder.js";
import { schedulePreview } from "../services/previewService.js";

const METHOD_OPTIONS = [
  { id: "voronoi", value: "Voronoi" },
  { id: "inflation", value: "Inflationär" },
];

const VORONOI_FIELDS = ["voronoiJitter", "voronoiRelaxIterations"];
const INFLATION_FIELDS = ["inflationIrregularity", "inflationDrift"];

function fieldId(name) {
  return `continentField-${name}`;
}

export function ensureContinentsPanel() {
  const panelId = "panel-continents";
  const formId = "continentsForm";
  const workspace = webix.$$("workspaceArea");
  if (!workspace) return panelId;
  if (webix.$$(panelId)) {
    return panelId;
  }
  const values = getContinentSettings();
  workspace.addView({
    id: panelId,
    css: "webix_dark workspace-panel",
    type: "clean",
    cols: [
      {
        gravity: 2,
        rows: [
          {
            template:
              "<div style='padding:24px 24px 16px'><div class='section-title'>Kontinente</div><div class='notes'>Lege Anzahl und Generator der Kontinente fest. Vorschau rechts folgt dem Combine-Layout.</div></div>",
            borderless: true,
            autoheight: true,
          },
          {
            view: "scrollview",
            body: {
              view: "form",
              id: formId,
              borderless: true,
              padding: { top: 0, left: 24, right: 24, bottom: 24 },
              elementsConfig: { labelWidth: 170 },
              elements: buildFormElements(values),
            },
          },
        ],
      },
      { view: "resizer" },
      {
        gravity: 1,
        rows: [
          {
            template:
              "<div style='padding:24px 24px 4px'><div class='section-title'>Preview</div><div class='notes'>Zeigt die aktuelle Kontinent-Aufteilung.</div></div>",
            borderless: true,
            autoheight: true,
          },
          {
            view: "template",
            css: "noise-preview-container",
            borderless: true,
            gravity: 1,
            template: `
              <div class='noise-preview-wrapper combine-preview'>
                <div id='continentsPreviewStatus' class='noise-preview-status'>Noch keine Vorschau</div>
                <img id='continentsPreviewImg' class='noise-preview-image' alt='Continents preview' />
                <div id='continentsPreviewMeta' class='noise-preview-status' style='bottom:12px; left:12px; top:auto;'>-</div>
              </div>
            `,
          },
        ],
      },
    ],
  });
  const form = webix.$$(formId);
  if (form) {
    bindFormEvents(form);
  }
  syncContinentsPanel();
  return panelId;
}

export function syncContinentsPanel() {
  const form = webix.$$("continentsForm");
  const values = getContinentSettings();
  if (form) {
    form.blockEvent();
    form.setValues(values, true);
    form.unblockEvent();
    applyMethodFieldState(values.method);
  }
  updateTreeLabel(values.continentCount);
  scheduleContinentsPreview();
}

function buildFormElements(values) {
  return [
    {
      cols: [
        { view: "combo", name: "method", id: fieldId("method"), label: "Generator", options: METHOD_OPTIONS, value: values.method },
        { width: 12 },
        {
          view: "button",
          value: "Seed neu würfeln",
          css: "webix_secondary",
          width: 170,
          click: () => rerollSeed(),
        },
      ],
    },
    { height: 12, borderless: true },
    { view: "text", name: "continentCount", id: fieldId("continentCount"), label: "Anzahl Kontinente", type: "number", value: values.continentCount },
    { height: 8, borderless: true },
    { view: "text", name: "seed", id: fieldId("seed"), label: "Seed", type: "number", value: values.seed },
    { height: 16, borderless: true },
    {
      template: "<div class='section-title'>Voronoi</div><div class='notes'>Gleichmäßige Splits, optional leicht verrauscht.</div>",
      borderless: true,
      autoheight: true,
    },
    { height: 6, borderless: true },
    { view: "text", name: "voronoiJitter", id: fieldId("voronoiJitter"), label: "Jitter (0-1)", type: "number", value: values.voronoiJitter },
    { height: 6, borderless: true },
    {
      view: "text",
      name: "voronoiRelaxIterations",
      id: fieldId("voronoiRelaxIterations"),
      label: "Lloyd Relax Iterationen",
      type: "number",
      value: values.voronoiRelaxIterations,
    },
    { height: 18, borderless: true },
    {
      template: "<div class='section-title'>Inflationär</div><div class='notes'>Kontinente wachsen Zell für Zell, inspiriert von Civ.</div>",
      borderless: true,
      autoheight: true,
    },
    { height: 6, borderless: true },
    {
      view: "text",
      name: "inflationIrregularity",
      id: fieldId("inflationIrregularity"),
      label: "Unregelmäßigkeit (0-1)",
      type: "number",
      value: values.inflationIrregularity,
    },
    { height: 6, borderless: true },
    {
      view: "text",
      name: "inflationDrift",
      id: fieldId("inflationDrift"),
      label: "Drift / Ausläufer (0-1)",
      type: "number",
      value: values.inflationDrift,
    },
  ];
}

function bindFormEvents(container) {
  const children = container.getChildViews ? container.getChildViews() : [];
  children.forEach((child) => {
    if (child.config && child.config.name && !child.config.__continentBound) {
      child.config.__continentBound = true;
      child.attachEvent("onChange", (value) => handleFieldChange(child.config.name, value));
    }
    if (child.getChildViews) {
      bindFormEvents(child);
    }
  });
}

function handleFieldChange(name, rawValue) {
  const updates = {};
  if (name === "method") {
    updates.method = rawValue;
  } else if (name === "continentCount") {
    updates.continentCount = parseInt(rawValue, 10);
  } else if (name === "seed") {
    updates.seed = parseInt(rawValue, 10);
  } else if (name === "voronoiJitter") {
    updates.voronoiJitter = parseFloat(rawValue);
  } else if (name === "voronoiRelaxIterations") {
    updates.voronoiRelaxIterations = parseInt(rawValue, 10);
  } else if (name === "inflationIrregularity") {
    updates.inflationIrregularity = parseFloat(rawValue);
  } else if (name === "inflationDrift") {
    updates.inflationDrift = parseFloat(rawValue);
  }
  const next = updateContinentSettings(updates);
  applyMethodFieldState(next.method);
  updateTreeLabel(next.continentCount);
  scheduleContinentsPreview();
}

function applyMethodFieldState(method) {
  const enableVoronoi = method === "voronoi";
  const enableInflation = method === "inflation";
  toggleFields(VORONOI_FIELDS, enableVoronoi);
  toggleFields(INFLATION_FIELDS, enableInflation);
}

function toggleFields(fields, enabled) {
  fields.forEach((name) => {
    const view = webix.$$(fieldId(name));
    if (!view) return;
    if (enabled) {
      view.enable();
    } else {
      view.disable();
    }
  });
}

function scheduleContinentsPreview() {
  const previewSize = getContinentPreviewSize(projectState.spec.size || 512);
  const metaEl = document.getElementById("continentsPreviewMeta");
  if (metaEl) {
    metaEl.textContent = `${previewSize} x ${previewSize}`;
  }
  schedulePreview({
    nodeId: "continents",
    width: previewSize,
    height: previewSize,
    statusId: "continentsPreviewStatus",
    imageId: "continentsPreviewImg",
    buildJob: () => buildContinentsPreviewJob(getContinentSettings()),
  });
}

function updateTreeLabel(count) {
  const tree = webix.$$("navigation");
  if (!tree || !tree.exists("continents")) return;
  const item = tree.getItem("continents");
  item.value = Number.isFinite(count) ? `Kontinente (${count})` : "Kontinente";
  tree.updateItem("continents", item);
}

function rerollSeed() {
  const seed = Math.floor(Math.random() * 1_000_000);
  const form = webix.$$("continentsForm");
  updateContinentSettings({ seed });
  if (form) {
    const field = webix.$$(fieldId("seed"));
    form.blockEvent();
    if (field) {
      field.setValue(seed);
    }
    form.unblockEvent();
  }
  scheduleContinentsPreview();
}
