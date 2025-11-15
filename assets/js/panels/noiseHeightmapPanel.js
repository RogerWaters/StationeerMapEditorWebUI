import {
  NOISE_HEIGHTMAP_DEFAULTS,
  projectState,
  updateHeightmapSettings,
  getHeightmapById,
} from "../state/projectState.js";
import { schedulePreview } from "../services/previewService.js";
import { buildPreviewTree } from "../services/previewBuilder.js";

const COMBO_FIELDS = new Set([
  "noiseType",
  "fractalType",
  "cellularDistanceFunction",
  "cellularReturnType",
  "domainWarpType",
]);

function sectionTemplate(title, description = "") {
  return {
    template: `
      <div class="section-title">${title}</div>
      ${description ? `<div class="notes">${description}</div>` : ""}
    `,
    borderless: true,
    autoheight: true,
  };
}

function spacer(height = 12) {
  return { height, borderless: true };
}

const noiseTypeOptions = [
  { id: "opensimplex2", value: "OpenSimplex2" },
  { id: "opensimplex2s", value: "OpenSimplex2S" },
  { id: "cellular", value: "Cellular" },
  { id: "perlin", value: "Perlin" },
  { id: "value", value: "Value" },
  { id: "valuecubic", value: "Value Cubic" },
];

const fractalTypeOptions = [
  { id: "none", value: "None" },
  { id: "fbm", value: "FBm" },
  { id: "ridged", value: "Ridged" },
  { id: "pingpong", value: "Ping Pong" },
];

const distanceFunctionOptions = [
  { id: "euclidean", value: "Euclidean" },
  { id: "euclideansq", value: "Euclidean Sq" },
  { id: "manhattan", value: "Manhattan" },
  { id: "hybrid", value: "Hybrid" },
];

const cellularReturnOptions = [
  { id: "cellvalue", value: "Cell Value" },
  { id: "distance", value: "Distance" },
  { id: "distance2", value: "Distance 2" },
  { id: "distance2add", value: "Distance 2 +" },
  { id: "distance2sub", value: "Distance 2 -" },
  { id: "distance2mul", value: "Distance 2 *" },
  { id: "distance2div", value: "Distance 2 /" },
];

const domainWarpOptions = [
  { id: "opensimplex2", value: "OpenSimplex2" },
  { id: "opensimplex2reduced", value: "OpenSimplex2 Reduced" },
  { id: "basicgrid", value: "Basic Grid" },
];

function getFieldId(nodeId, name) {
  return `noiseField-${nodeId}-${name}`;
}

function buildField(nodeId, name, config) {
  return {
    ...config,
    name,
    id: getFieldId(nodeId, name),
  };
}

function formElements(nodeId, values) {
  return [
    sectionTemplate("Layer", "Gib dieser Heightmap einen eindeutigen Namen."),
    buildField(nodeId, "displayName", { view: "text", label: "Name", value: values.displayName || "" }),
    spacer(16),
    sectionTemplate(
      "Noise",
      "Seed, Frequenz und Offsets steuern die globale Form der Heightmap."
    ),
    {
      cols: [
        buildField(nodeId, "noiseType", { view: "combo", label: "Noise Type", options: noiseTypeOptions, value: values.noiseType }),
        { width: 16 },
        buildField(nodeId, "seed", { view: "text", label: "Seed", type: "number", value: values.seed }),
      ],
    },
    spacer(),
    {
      cols: [
        buildField(nodeId, "frequency", { view: "text", label: "Frequency", type: "number", value: values.frequency }),
        { width: 16 },
        buildField(nodeId, "offsetX", { view: "text", label: "Offset X", type: "number", value: values.offsetX }),
      ],
    },
    spacer(),
    buildField(nodeId, "offsetY", { view: "text", label: "Offset Y", type: "number", value: values.offsetY }),
    spacer(24),
    sectionTemplate("Fractal"),
    {
      cols: [
        buildField(nodeId, "fractalType", { view: "combo", label: "Fractal Type", options: fractalTypeOptions, value: values.fractalType }),
        { width: 16 },
        buildField(nodeId, "octaves", { view: "text", label: "Octaves", type: "number", value: values.octaves }),
      ],
    },
    spacer(),
    {
      cols: [
        buildField(nodeId, "lacunarity", { view: "text", label: "Lacunarity", type: "number", value: values.lacunarity }),
        { width: 16 },
        buildField(nodeId, "gain", { view: "text", label: "Gain", type: "number", value: values.gain }),
      ],
    },
    spacer(),
    {
      cols: [
        buildField(nodeId, "weightedStrength", { view: "text", label: "Weighted Strength", type: "number", value: values.weightedStrength }),
        { width: 16 },
        buildField(nodeId, "pingPongStrength", { view: "text", label: "Ping Pong Strength", type: "number", value: values.pingPongStrength }),
      ],
    },
    spacer(24),
    sectionTemplate("Cellular"),
    {
      cols: [
        buildField(nodeId, "cellularDistanceFunction", { view: "combo", label: "Distance Function", options: distanceFunctionOptions, value: values.cellularDistanceFunction }),
        { width: 16 },
        buildField(nodeId, "cellularReturnType", { view: "combo", label: "Return Type", options: cellularReturnOptions, value: values.cellularReturnType }),
      ],
    },
    spacer(),
    buildField(nodeId, "cellularJitter", { view: "text", label: "Jitter", type: "number", value: values.cellularJitter }),
    spacer(24),
    sectionTemplate("Domain Warp", "Biegt die Sampling-Koordinaten, um organische Strukturen zu erhalten."),
    {
      cols: [
        buildField(nodeId, "domainWarpType", { view: "combo", label: "Warp Type", options: domainWarpOptions, value: values.domainWarpType }),
        { width: 16 },
        buildField(nodeId, "domainWarpFrequency", { view: "text", label: "Warp Frequency", type: "number", value: values.domainWarpFrequency }),
      ],
    },
    spacer(),
    buildField(nodeId, "domainWarpAmplitude", { view: "text", label: "Warp Amplitude", type: "number", value: values.domainWarpAmplitude }),
  ];
}

export function ensureNoiseHeightmapPanel(node) {
  const panelId = `panel-noise-${node.id}`;
  const formId = `noiseHeightmapForm-${node.id}`;
  const workspace = webix.$$("workspaceArea");
  if (!workspace) return panelId;
  if (webix.$$(panelId)) {
    return panelId;
  }
  const initialValues = { ...NOISE_HEIGHTMAP_DEFAULTS, ...(node.settings || {}) };
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
              "<div style='padding:24px 24px 8px'><div class='section-title'>Noise Heightmap</div><div class='notes'>Parametrisiere die FastNoiseLite Einstellungen für diese 2D-Heightmap.</div></div>",
            borderless: true,
            autoheight: true,
          },
          {
            view: "scrollview",
            css: "workspace-panel-scroll",
            gravity: 1,
            body: {
              view: "form",
              id: formId,
              borderless: true,
              padding: { top: 0, left: 24, right: 24, bottom: 24 },
              elementsConfig: { labelWidth: 150 },
              elements: formElements(node.id, initialValues),
            },
          },
        ],
      },
      { view: "resizer" },
      {
        gravity: 1,
        rows: [
          {
            template: `<div style='padding:24px 24px 8px'><div class='section-title'>Preview</div><div class='notes'>Auflösung <span id='noisePreviewMeta-${node.id}'>-</span></div></div>`,
            borderless: true,
            autoheight: true,
          },
          {
            view: "template",
            borderless: true,
            gravity: 1,
            css: "noise-preview-container",
            template: `
              <div class='noise-preview-wrapper'>
                <div id='noisePreviewStatus-${node.id}' class='noise-preview-status'>Noch keine Vorschau</div>
                <img id='noisePreviewImg-${node.id}' class='noise-preview-image' alt='Noise preview' />
              </div>
            `,
          },
        ],
      },
    ],
  });
  const form = webix.$$(formId);
  if (form) {
    bindFormEvents(form, node.id);
    applyFieldAvailability(node.id);
  }
  webix.delay(() => {
    scheduleNoisePreview(node.id);
  });
  return panelId;
}

export function syncNoiseHeightmapPanel(node) {
  const form = webix.$$(`noiseHeightmapForm-${node.id}`);
  if (form) {
    form.blockEvent();
    form.setValues({ ...NOISE_HEIGHTMAP_DEFAULTS, ...(node.settings || {}) }, true);
    form.unblockEvent();
    bindFormEvents(form, node.id);
    applyFieldAvailability(node.id);
  }
  webix.delay(() => {
    scheduleNoisePreview(node.id);
  });
}

function bindFormEvents(container, nodeId) {
  const children = container.getChildViews ? container.getChildViews() : [];
  children.forEach((child) => {
    if (child.config && child.config.name && !child.config.__noiseBound) {
      child.config.__noiseBound = true;
      child.attachEvent("onChange", function (newValue) {
        handleControlChange(nodeId, child.config.name, newValue);
      });
    }
    if (child.getChildViews) {
      bindFormEvents(child, nodeId);
    }
  });
}

function handleControlChange(nodeId, name, rawValue) {
  const parsed = parseSettingValue(name, rawValue);
  if (name === "displayName") {
    const nextLabel = (parsed || "").trim();
    updateHeightmapSettings(nodeId, { displayName: nextLabel });
    const tree = webix.$$("navigation");
    if (tree && tree.exists(nodeId)) {
      const item = tree.getItem(nodeId);
      item.value = nextLabel || item.value;
      tree.updateItem(nodeId, item);
    }
    return;
  }
  updateHeightmapSettings(nodeId, { [name]: parsed });
  applyFieldAvailability(nodeId);
  scheduleNoisePreview(nodeId);
}

function parseSettingValue(name, value) {
  if (name === "displayName") {
    return value;
  }
  if (COMBO_FIELDS.has(name)) {
    return value;
  }
  const numeric = parseFloat(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function scheduleNoisePreview(nodeId) {
  const size = projectState.spec.size || 256;
  const metaEl = document.getElementById(`noisePreviewMeta-${nodeId}`);
  if (metaEl) {
    metaEl.textContent = `${size} x ${size}`;
  }
  schedulePreview({
    nodeId,
    width: size,
    height: size,
    statusId: `noisePreviewStatus-${nodeId}`,
    imageId: `noisePreviewImg-${nodeId}`,
    buildJob: () => buildPreviewTree(nodeId),
  });
}

function applyFieldAvailability(nodeId) {
  const entry = getHeightmapById(nodeId);
  const form = webix.$$(`noiseHeightmapForm-${nodeId}`);
  if (!entry || !form) return;
  const settings = { ...NOISE_HEIGHTMAP_DEFAULTS, ...(entry.node.settings || {}) };
  const noiseType = (settings.noiseType || "").toLowerCase();
  const fractalType = (settings.fractalType || "none").toLowerCase();
  const enableCellular = noiseType === "cellular";
  toggleFields(nodeId, ["cellularDistanceFunction", "cellularReturnType", "cellularJitter"], enableCellular);
  const enableFractal = fractalType !== "none";
  toggleFields(nodeId, ["octaves", "lacunarity", "gain", "weightedStrength"], enableFractal);
  toggleFields(nodeId, ["pingPongStrength"], fractalType === "pingpong");
}

function toggleFields(nodeId, fields, enabled) {
  fields.forEach((name) => {
    const view = webix.$$(getFieldId(nodeId, name));
    if (!view) return;
    if (enabled) {
      view.enable();
    } else {
      view.disable();
    }
  });
}
