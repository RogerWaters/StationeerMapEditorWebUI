import {
  UPLOAD_HEIGHTMAP_DEFAULTS,
  getHeightmapById,
  projectState,
  updateHeightmapSettings,
} from "../state/projectState.js";
import { schedulePreview } from "../services/previewService.js";
import { buildPreviewTree } from "../services/previewBuilder.js";

const mappingOptions = [
  { id: "cover", value: "Cover" },
  { id: "contain", value: "Contain" },
];

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

function getSourceInfoId(nodeId) {
  return `uploadSourceInfo-${nodeId}`;
}

function getFormId(nodeId) {
  return `uploadHeightmapForm-${nodeId}`;
}

function getUploaderId(nodeId) {
  return `uploadHeightmapUploader-${nodeId}`;
}

export function ensureUploadHeightmapPanel(node) {
  const panelId = `panel-upload-${node.id}`;
  const workspace = webix.$$("workspaceArea");
  if (!workspace) return panelId;
  if (webix.$$(panelId)) {
    return panelId;
  }
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
              "<div style='padding:24px 24px 8px'><div class='section-title'>Upload Heightmap</div><div class='notes'>Verwende vorhandene Bilder als Heightmap Layer.</div></div>",
            borderless: true,
            autoheight: true,
          },
          {
            view: "scrollview",
            css: "workspace-panel-scroll",
            body: {
              view: "form",
              id: getFormId(node.id),
              borderless: true,
              padding: { top: 0, left: 24, right: 24, bottom: 24 },
              elementsConfig: { labelWidth: 150 },
              elements: buildFormElements(node),
            },
          },
        ],
      },
      { view: "resizer" },
      {
        gravity: 1,
        rows: [
          {
            template: `<div style='padding:24px 24px 6px'><div class='section-title'>Preview</div><div class='notes'>Auflösung <span id='uploadPreviewMeta-${node.id}'>-</span></div></div>`,
            borderless: true,
            autoheight: true,
          },
          {
            view: "template",
            css: "noise-preview-container",
            borderless: true,
            gravity: 1,
            template: `
              <div class='noise-preview-wrapper'>
                <div id='uploadPreviewStatus-${node.id}' class='noise-preview-status'>Noch keine Vorschau</div>
                <img id='uploadPreviewImg-${node.id}' class='noise-preview-image' alt='Upload preview' />
              </div>
            `,
          },
        ],
      },
    ],
  });
  syncUploadHeightmapPanel(node);
  return panelId;
}

export function syncUploadHeightmapPanel(node) {
  const formId = getFormId(node.id);
  const form = webix.$$(formId);
  const values = normalizeUploadSettings(node);
  if (form) {
    form.blockEvent();
    form.setValues(values, true);
    form.unblockEvent();
    bindUploadFormEvents(form, node.id);
  }
  bindUploader(node.id);
  updateSourceInfo(node.id, values.sourceImage);
  applyUploadFieldAvailability(node.id);
  scheduleUploadPreview(node.id);
}

function buildFormElements(node) {
  const values = normalizeUploadSettings(node);
  return [
    sectionTemplate("Layer"),
    {
      view: "text",
      name: "displayName",
      id: getFieldId(node.id, "displayName"),
      label: "Name",
      value: values.displayName || "",
    },
    spacer(20),
    sectionTemplate("Bildquelle", "Unterstützt werden PNG, JPG und WEBP Dateien."),
    {
      cols: [
        {
          view: "uploader",
          value: "Bild auswählen",
          css: "webix_primary",
          id: getUploaderId(node.id),
          accept: "image/png,image/jpeg,image/webp",
          autosend: false,
          multiple: false,
          width: 180,
        },
        { width: 12 },
        {
          template: `<div id='${getSourceInfoId(node.id)}' class='notes'>${renderSourceInfo(values.sourceImage)}</div>`,
          borderless: true,
          autoheight: true,
        },
      ],
    },
    spacer(20),
    sectionTemplate("Mapping", "Bestimmt wie das Bild in die Weltgröße eingepasst wird."),
    {
      cols: [
        {
          view: "combo",
          name: "mapping",
          id: getFieldId(node.id, "mapping"),
          label: "Modus",
          options: mappingOptions,
          value: values.mapping || "contain",
        },
        { width: 12 },
        {
          view: "checkbox",
          name: "invert",
          id: getFieldId(node.id, "invert"),
          labelRight: "Invertieren",
          value: values.invert ? 1 : 0,
        },
      ],
    },
    spacer(16),
    {
      cols: [
        {
          view: "text",
          name: "minValue",
          id: getFieldId(node.id, "minValue"),
          label: "Min Value",
          type: "number",
          value: values.minValue,
        },
        { width: 16 },
        {
          view: "text",
          name: "maxValue",
          id: getFieldId(node.id, "maxValue"),
          label: "Max Value",
          type: "number",
          value: values.maxValue,
        },
      ],
    },
    spacer(12),
    {
      view: "checkbox",
      name: "normalize",
      id: getFieldId(node.id, "normalize"),
      labelRight: "Normalize",
      value: values.normalize ? 1 : 0,
    },
  ];
}

function normalizeUploadSettings(node) {
  const merged = { ...UPLOAD_HEIGHTMAP_DEFAULTS, ...(node.settings || {}) };
  if (!merged.displayName && node.value) {
    merged.displayName = node.value;
  }
  return merged;
}

function bindUploadFormEvents(view, nodeId) {
  attachUploadListeners(view, nodeId);
}

function attachUploadListeners(view, nodeId) {
  if (view.config && view.config.name && !view.config.__uploadBound) {
    view.config.__uploadBound = true;
    view.attachEvent("onChange", (value) => handleControlChange(nodeId, view.config.name, value));
  }
  const children = view.getChildViews ? view.getChildViews() : [];
  children.forEach((child) => attachUploadListeners(child, nodeId));
}

function handleControlChange(nodeId, name, rawValue) {
  if (name === "displayName") {
    const trimmed = (rawValue || "").trim();
    updateHeightmapSettings(nodeId, { displayName: trimmed });
    const tree = webix.$$("navigation");
    if (tree && tree.exists(nodeId)) {
      const item = tree.getItem(nodeId);
      item.value = trimmed || item.value;
      tree.updateItem(nodeId, item);
    }
    return;
  }
  if (name === "mapping") {
    updateHeightmapSettings(nodeId, { mapping: rawValue || "contain" });
  } else if (name === "minValue") {
    updateHeightmapSettings(nodeId, { minValue: parseFloat(rawValue) || 0 });
  } else if (name === "maxValue") {
    updateHeightmapSettings(nodeId, { maxValue: parseFloat(rawValue) || 1 });
  } else if (name === "normalize") {
    updateHeightmapSettings(nodeId, { normalize: !!rawValue });
  } else if (name === "invert") {
    updateHeightmapSettings(nodeId, { invert: !!rawValue });
  }
  applyUploadFieldAvailability(nodeId);
  scheduleUploadPreview(nodeId);
}

function bindUploader(nodeId) {
  const uploader = webix.$$(getUploaderId(nodeId));
  if (!uploader || uploader.__uploadBound) return;
  uploader.__uploadBound = true;
  uploader.attachEvent("onBeforeFileAdd", (item) => {
    if (!item || !item.file) {
      return false;
    }
    processSelectedFile(nodeId, item.file);
    return false;
  });
}

async function processSelectedFile(nodeId, file) {
  setStatus(getSourceInfoId(nodeId), "Lade Datei...");
  try {
    const sourceImage = await extractImageData(file);
    updateHeightmapSettings(nodeId, { sourceImage });
    updateSourceInfo(nodeId, sourceImage);
    scheduleUploadPreview(nodeId);
  } catch (error) {
    console.error("Upload parsing failed", error);
    updateSourceInfo(nodeId, null, "Fehler beim Laden.");
  }
}

function updateSourceInfo(nodeId, sourceImage, fallbackText) {
  const infoId = getSourceInfoId(nodeId);
  const text = fallbackText || renderSourceInfo(sourceImage);
  setStatus(infoId, text);
}

function renderSourceInfo(sourceImage) {
  if (!sourceImage) {
    return "Noch kein Bild gewählt.";
  }
  let name = sourceImage.name || "Bild";
  if (window.webix?.html?.escape) {
    name = window.webix.html.escape(name);
  }
  return `${name} – ${sourceImage.width} x ${sourceImage.height}px`;
}

function setStatus(elementId, text) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = text;
  }
}

async function extractImageData(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas Kontext nicht verfügbar.");
  }
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const grayscale = new Float32Array(width * height);
  for (let i = 0, j = 0; i < grayscale.length; i += 1, j += 4) {
    const r = pixels[j];
    const g = pixels[j + 1];
    const b = pixels[j + 2];
    const value = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    grayscale[i] = value;
  }
  return {
    name: file.name,
    width,
    height,
    pixels: grayscale,
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Konnte Datei nicht lesen."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err || new Error("Bild konnte nicht geladen werden."));
    img.src = src;
  });
}

function applyUploadFieldAvailability(nodeId) {
  const entry = getHeightmapById(nodeId);
  if (!entry) return;
  const settings = normalizeUploadSettings(entry.node);
  const disabled = !!settings.normalize;
  toggleField(nodeId, "minValue", !disabled);
  toggleField(nodeId, "maxValue", !disabled);
}

function toggleField(nodeId, name, enabled) {
  const viewId = getFieldId(nodeId, name);
  const view = webix.$$(viewId);
  if (!view) return;
  if (enabled) {
    view.enable();
  } else {
    view.disable();
  }
}

function getFieldId(nodeId, name) {
  return `${getFormId(nodeId)}-${name}`;
}

function scheduleUploadPreview(nodeId) {
  const size = projectState.spec.size || 256;
  const meta = document.getElementById(`uploadPreviewMeta-${nodeId}`);
  if (meta) {
    meta.textContent = `${size} x ${size}`;
  }
  schedulePreview({
    nodeId,
    width: size,
    height: size,
    statusId: `uploadPreviewStatus-${nodeId}`,
    imageId: `uploadPreviewImg-${nodeId}`,
    buildJob: () => buildPreviewTree(nodeId),
  });
}
