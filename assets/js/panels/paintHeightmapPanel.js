import {
  PAINT_HEIGHTMAP_DEFAULTS,
  getHeightmapById,
  projectState,
  updateHeightmapSettings,
} from "../state/projectState.js";
import { schedulePreview } from "../services/previewService.js";
import { buildPreviewTree } from "../services/previewBuilder.js";
import { queuePaintInference } from "../services/paintModelService.js";

const TOOL_CONFIG = {
  peak: { color: "#ff0000", value: 1 },
  valley: { color: "#0000ff", value: 0 },
  eraser: { color: "#000000", value: 0.5 },
};

const controllers = new Map();
if (typeof window !== "undefined") {
  window.PaintControllers = controllers;
}

function formId(nodeId) {
  return `paintHeightmapForm-${nodeId}`;
}

function canvasTemplateId(nodeId) {
  return `paintCanvasBlock-${nodeId}`;
}

function getFieldId(nodeId, name) {
  return `${formId(nodeId)}-${name}`;
}

function previewIds(nodeId) {
  return {
    meta: `paintPreviewMeta-${nodeId}`,
    status: `paintPreviewStatus-${nodeId}`,
    image: `paintPreviewImg-${nodeId}`,
  };
}

function updateSliderTooltip(fieldId, text) {
  const slider = webix.$$(fieldId);
  if (slider && slider.define) {
    slider.define("title", text);
    slider.refresh();
  }
}

function clampPercentValue(value) {
  const numeric = parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(100, numeric));
}

export function ensurePaintHeightmapPanel(node) {
  const panelId = `panel-paint-${node.id}`;
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
              "<div style='padding:24px 24px 8px'><div class='section-title'>Paint Heightmap</div><div class='notes'>Zeichne Peaks und Valleys – die Vorschau interpretiert die Linien als fertige Heightmap.</div></div>",
            borderless: true,
            autoheight: true,
          },
          {
            view: "scrollview",
            css: "workspace-panel-scroll",
            body: {
              rows: [
                {
                  view: "form",
                  id: formId(node.id),
                  borderless: true,
                  padding: { left: 24, right: 24, bottom: 12 },
                  elementsConfig: { labelWidth: 140 },
                  elements: buildFormElements(node),
                },
                {
                  view: "template",
                  id: canvasTemplateId(node.id),
                  borderless: true,
                  css: "paint-panel-shell",
                  template: buildCanvasTemplate(node.id),
                  autoheight: true,
                },
              ],
            },
          },
        ],
      },
      { view: "resizer" },
      buildPreviewColumn(node.id),
    ],
  });
  syncPaintHeightmapPanel(node);
  return panelId;
}

export function syncPaintHeightmapPanel(node) {
  const form = webix.$$(formId(node.id));
  const values = normalizeSettings(node);
  if (form) {
    form.blockEvent();
    form.setValues(values, true);
    form.unblockEvent();
    bindFormEvents(form, node.id);
  }
  ensureController(node);
  schedulePaintPreview(node.id);
}

function buildFormElements(node) {
  const values = normalizeSettings(node);
  return [
    {
      view: "text",
      name: "displayName",
      id: getFieldId(node.id, "displayName"),
      label: "Name",
      value: values.displayName || "",
    },
    {
      view: "slider",
      name: "brushSize",
      id: getFieldId(node.id, "brushSize"),
      label: "Brush Size",
      value: values.brushSize || 2,
      min: 1,
      max: 10,
      step: 0.25,
      title: values.brushSize ? `${values.brushSize}px` : "2px",
    },
    {
      view: "checkbox",
      name: "normalizeResult",
      id: getFieldId(node.id, "normalizeResult"),
      label: "Normalize",
      value: values.normalizeResult ? 1 : 0,
    },
    {
      view: "slider",
      name: "blurAmount",
      id: getFieldId(node.id, "blurAmount"),
      label: "Blur (%)",
      value: typeof values.blurAmount === "number" ? values.blurAmount : 1,
      min: 0,
      max: 100,
      step: 1,
      title: `${typeof values.blurAmount === "number" ? values.blurAmount : 1}%`,
    },
  ];
}

function buildCanvasTemplate(nodeId) {
  return `
    <div class="paint-panel-body" id="paintPanel-${nodeId}">
      <div class="paint-toolbar" id="paintToolbar-${nodeId}">
        <button type="button" class="paint-tool" data-tool="peak">▲ Peak</button>
        <button type="button" class="paint-tool" data-tool="valley">▼ Valley</button>
        <button type="button" class="paint-tool" data-tool="eraser">⏹ Eraser</button>
        <div class="paint-toolbar-spacer"></div>
        <button type="button" class="paint-tool paint-tool-clear" data-action="clear">❌ Clear</button>
      </div>
      <div class="paint-status" id="paintStatus-${nodeId}"></div>
      <div class="paint-canvas-container">
        <canvas id="paintCanvas-${nodeId}" class="paint-canvas" width="512" height="512"></canvas>
      </div>
    </div>
  `;
}

function buildPreviewColumn(nodeId) {
  const ids = previewIds(nodeId);
  const inputImgId = `paintInputImg-${nodeId}`;
  const modelImgId = `paintModelImg-${nodeId}`;
  return {
    gravity: 1,
    rows: [
      {
        template: `<div style='padding:24px 24px 6px'><div class='section-title'>LinesToTerrain Input</div><div class='notes'>512 x 512</div></div>`,
        borderless: true,
        autoheight: true,
      },
      {
        view: "template",
        borderless: true,
        css: "noise-preview-container",
        gravity: 1,
        template: `
          <div class='noise-preview-wrapper'>
            <img id='${inputImgId}' class='noise-preview-image' alt='TF input preview' />
          </div>
        `,
      },
      {
        template: `<div style='padding:24px 24px 6px'><div class='section-title'>LinesToTerrain Output</div><div class='notes'>512 x 512</div></div>`,
        borderless: true,
        autoheight: true,
      },
      {
        view: "template",
        borderless: true,
        css: "noise-preview-container",
        gravity: 1,
        template: `
          <div class='noise-preview-wrapper'>
            <img id='${modelImgId}' class='noise-preview-image' alt='TF output preview' />
          </div>
        `,
      },
      {
        template: `<div style='padding:24px 24px 6px'><div class='section-title'>Workspace Preview</div><div class='notes'>Auflösung <span id='${ids.meta}'>-</span></div></div>`,
        borderless: true,
        autoheight: true,
      },
      {
        view: "template",
        borderless: true,
        css: "noise-preview-container",
        gravity: 1,
        template: `
          <div class='noise-preview-wrapper'>
            <div id='${ids.status}' class='noise-preview-status'>Noch keine Vorschau</div>
            <img id='${ids.image}' class='noise-preview-image' alt='Paint preview' />
          </div>
        `,
      },
    ],
  };
}

function normalizeSettings(node) {
  return { ...PAINT_HEIGHTMAP_DEFAULTS, ...(node.settings || {}) };
}

function bindFormEvents(form, nodeId) {
  const children = form.getChildViews ? form.getChildViews() : [];
  children.forEach((child) => {
    if (child.config && child.config.name && !child.config.__paintBound) {
      child.config.__paintBound = true;
      child.attachEvent("onChange", (newValue) => handleFormChange(nodeId, child.config.name, newValue));
    }
    if (child.getChildViews) {
      bindFormEvents(child, nodeId);
    }
  });
}

function handleFormChange(nodeId, name, rawValue) {
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
  if (name === "brushSize") {
    const numeric = parseFloat(rawValue);
    const brush = Number.isFinite(numeric) ? numeric : 2;
    updateHeightmapSettings(nodeId, { brushSize: brush });
    updateSliderTooltip(getFieldId(nodeId, "brushSize"), `${brush}px`);
    const controller = controllers.get(nodeId);
    if (controller) {
      controller.setBrushSize(brush);
    }
    return;
  }
  if (name === "normalizeResult") {
    const enabled = !!rawValue;
    updateHeightmapSettings(nodeId, { normalizeResult: enabled });
    const controller = controllers.get(nodeId);
    controller?.updateSetting("normalizeResult", enabled);
    return;
  }
  if (name === "blurAmount") {
    const blur = clampPercentValue(rawValue);
    updateHeightmapSettings(nodeId, { blurAmount: blur });
    updateSliderTooltip(getFieldId(nodeId, "blurAmount"), `${blur}%`);
    const controller = controllers.get(nodeId);
    controller?.updateSetting("blurAmount", blur);
    return;
  }
}

function ensureController(node) {
  webix.delay(() => {
    const host = document.getElementById(`paintPanel-${node.id}`);
    const canvas = document.getElementById(`paintCanvas-${node.id}`);
    if (!host || !canvas) {
      return;
    }
    let controller = controllers.get(node.id);
    if (controller) {
      controller.updateNode(node);
      return;
    }
    controller = new PaintCanvasController(node, host, canvas);
    controllers.set(node.id, controller);
  });
}

function schedulePaintPreview(nodeId) {
  const ids = previewIds(nodeId);
  const size = projectState.spec.size || 256;
  const meta = document.getElementById(ids.meta);
  if (meta) {
    meta.textContent = `${size} x ${size}`;
  }
  schedulePreview({
    nodeId,
    width: size,
    height: size,
    statusId: ids.status,
    imageId: ids.image,
    buildJob: () => buildPreviewTree(nodeId),
  });
}

class PaintCanvasController {
  constructor(node, host, canvas) {
    this.nodeId = node.id;
    this.canvas = canvas;
    this.host = host;
    this.ctx = canvas.getContext("2d");
    this.dataCanvas = document.createElement("canvas");
    this.dataCanvas.width = canvas.width;
    this.dataCanvas.height = canvas.height;
    this.dataCtx = this.dataCanvas.getContext("2d", { willReadFrequently: true });
    this.isDrawing = false;
    this.lastPoint = null;
    this.tool = "peak";
    this.brushSize = PAINT_HEIGHTMAP_DEFAULTS.brushSize;
    this.statusEl = document.getElementById(`paintStatus-${node.id}`);
    this.autoQueued = false;
    this.modelCanvas = document.createElement("canvas");
    this.settings = { ...PAINT_HEIGHTMAP_DEFAULTS };
    this.attachToolbar();
    this.attachEvents();
    this.resetLayers();
    this.updateNode(node);
  }

  updateNode(node) {
    const settings = normalizeSettings(node);
    this.settings = { ...settings };
    this.tool = settings.tool || "peak";
    this.brushSize = settings.brushSize || PAINT_HEIGHTMAP_DEFAULTS.brushSize;
    this.syncToolbar();
    if (settings.canvasData?.displayUrl) {
      this.restoreDisplay(settings.canvasData.displayUrl);
      this.updateInputPreview(settings.canvasData.displayUrl);
    } else {
      this.resetLayers();
      this.setStatus("");
    }
    if (settings.canvasData?.pixels instanceof Float32Array) {
      this.restoreHeight(settings.canvasData);
    } else if (settings.canvasData?.pixels?.length) {
      this.restoreHeight({
        width: settings.canvasData.width,
        height: settings.canvasData.height,
        pixels: new Float32Array(settings.canvasData.pixels),
      });
    }
    if (!settings.canvasData) {
      this.resetLayers();
      this.setStatus("");
    }
    if (settings.generatedHeightmap) {
      this.updateModelPreview(settings.generatedHeightmap);
      this.setStatus("LinesToTerrain: Aktualisiert");
    }
    this.maybeAutoGenerate(settings);
  }

  attachToolbar() {
    this.toolbar = document.getElementById(`paintToolbar-${this.nodeId}`);
    if (!this.toolbar) return;
    this.toolbar.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      const tool = target.getAttribute("data-tool");
      const action = target.getAttribute("data-action");
      if (tool && TOOL_CONFIG[tool]) {
        this.setTool(tool);
      } else if (action === "clear") {
        this.clearCanvas();
      }
    });
    this.syncToolbar();
  }

  attachEvents() {
    this.canvas.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.handlePointerUp(event));
    this.canvas.addEventListener("pointerleave", (event) => this.handlePointerUp(event));
  }

  handlePointerDown(event) {
    event.preventDefault();
    this.isDrawing = true;
    this.lastPoint = this.getRelativePosition(event);
    this.drawPoint(this.lastPoint, true);
  }

  handlePointerMove(event) {
    if (!this.isDrawing) return;
    const point = this.getRelativePosition(event);
    this.drawLine(this.lastPoint, point);
    this.lastPoint = point;
  }

  handlePointerUp(event) {
    if (!this.isDrawing) return;
    event.preventDefault();
    this.isDrawing = false;
    this.lastPoint = null;
    this.saveState();
  }

  getRelativePosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * this.canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * this.canvas.height,
    };
  }

  drawLine(from, to) {
    if (!from) {
      this.drawPoint(to, false);
      return;
    }
    const displayColor = TOOL_CONFIG[this.tool].color;
    const dataValue = TOOL_CONFIG[this.tool].value;
    this.ctx.strokeStyle = displayColor;
    this.ctx.lineWidth = this.brushSize;
    this.ctx.lineCap = "round";
    this.ctx.lineJoin = "round";
    this.ctx.beginPath();
    this.ctx.moveTo(from.x, from.y);
    this.ctx.lineTo(to.x, to.y);
    this.ctx.stroke();

    const dataColor = Math.round(dataValue * 255);
    this.dataCtx.strokeStyle = `rgb(${dataColor},${dataColor},${dataColor})`;
    this.dataCtx.lineWidth = this.brushSize;
    this.dataCtx.lineCap = "round";
    this.dataCtx.lineJoin = "round";
    this.dataCtx.beginPath();
    this.dataCtx.moveTo(from.x, from.y);
    this.dataCtx.lineTo(to.x, to.y);
    this.dataCtx.stroke();
  }

  drawPoint(point, applyColor) {
    const displayColor = TOOL_CONFIG[this.tool].color;
    this.ctx.fillStyle = displayColor;
    this.ctx.beginPath();
    this.ctx.arc(point.x, point.y, this.brushSize / 2, 0, Math.PI * 2);
    this.ctx.fill();

    const dataColor = Math.round(TOOL_CONFIG[this.tool].value * 255);
    this.dataCtx.fillStyle = `rgb(${dataColor},${dataColor},${dataColor})`;
    this.dataCtx.beginPath();
    this.dataCtx.arc(point.x, point.y, this.brushSize / 2, 0, Math.PI * 2);
    this.dataCtx.fill();
  }

  clearCanvas() {
    this.resetLayers();
    this.saveState();
  }

  resetLayers() {
    this.ctx.fillStyle = "#000000";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const neutral = Math.round(0.5 * 255);
    this.dataCtx.fillStyle = `rgb(${neutral},${neutral},${neutral})`;
    this.dataCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.updateInputPreview(null);
    this.updateModelPreview(null);
  }

  restoreDisplay(dataUrl) {
    const img = new Image();
    img.onload = () => {
      this.ctx.drawImage(img, 0, 0, this.canvas.width, this.canvas.height);
    };
    img.src = dataUrl;
  }

  restoreHeight(canvasData) {
    if (!canvasData || !canvasData.pixels) return;
    const { width, height, pixels } = canvasData;
    if (!width || !height || pixels.length !== width * height) {
      return;
    }
    const imageData = this.dataCtx.createImageData(width, height);
    for (let i = 0; i < pixels.length; i += 1) {
      const value = Math.max(0, Math.min(1, pixels[i]));
      const color = Math.round(value * 255);
      const idx = i * 4;
      imageData.data[idx] = color;
      imageData.data[idx + 1] = color;
      imageData.data[idx + 2] = color;
      imageData.data[idx + 3] = 255;
    }
    this.dataCtx.putImageData(imageData, 0, 0);
  }

  extractFloatPixels() {
    const img = this.dataCtx.getImageData(0, 0, this.dataCanvas.width, this.dataCanvas.height);
    const floats = new Float32Array(this.dataCanvas.width * this.dataCanvas.height);
    for (let i = 0; i < floats.length; i += 1) {
      floats[i] = img.data[i * 4] / 255;
    }
    return floats;
  }

  saveState() {
    const pixels = this.extractFloatPixels();
    const rgbPixels = this.extractColorPixels();
    let dataUrl = null;
    try {
      dataUrl = this.canvas.toDataURL("image/png");
    } catch (error) {
      dataUrl = null;
    }
    this.updateInputPreview(dataUrl);
    updateHeightmapSettings(this.nodeId, {
      canvasData: {
        width: this.dataCanvas.width,
        height: this.dataCanvas.height,
        pixels,
        displayUrl: dataUrl,
        rgbPixels,
      },
      brushSize: this.brushSize,
      tool: this.tool,
    });
    const payload = {
      width: this.dataCanvas.width,
      height: this.dataCanvas.height,
      rgbPixels,
      ...this.getPostProcessOptions(),
    };
    this.runInference(payload);
    schedulePaintPreview(this.nodeId);
  }

  applySketchImage(imageData) {
    if (!imageData) return;
    const { width, height, data } = imageData;
    if (!width || !height) return;
    const display = this.ctx.createImageData(this.canvas.width, this.canvas.height);
    const dataLayer = this.dataCtx.createImageData(this.dataCanvas.width, this.dataCanvas.height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const srcIdx = (y * width + x) * 4;
        const r = data[srcIdx];
        const g = data[srcIdx + 1];
        const b = data[srcIdx + 2];
        const { value, color } = this.interpretSketchPixel(r, g, b);
        const dstIdx = (y * width + x) * 4;
        const rgb = this.hexToRgb(color);
        display.data[dstIdx] = rgb.r;
        display.data[dstIdx + 1] = rgb.g;
        display.data[dstIdx + 2] = rgb.b;
        display.data[dstIdx + 3] = 255;
        const grayscale = Math.round(Math.max(0, Math.min(1, value)) * 255);
        dataLayer.data[dstIdx] = grayscale;
        dataLayer.data[dstIdx + 1] = grayscale;
        dataLayer.data[dstIdx + 2] = grayscale;
        dataLayer.data[dstIdx + 3] = 255;
      }
    }
    this.ctx.putImageData(display, 0, 0);
    this.dataCtx.putImageData(dataLayer, 0, 0);
    this.saveState();
  }

  interpretSketchPixel(r, g, b) {
    const isPeak = r > 200 && g < 80 && b < 80;
    const isValley = b > 200 && r < 80 && g < 80;
    if (isPeak) {
      return { value: 1, color: TOOL_CONFIG.peak.color };
    }
    if (isValley) {
      return { value: 0, color: TOOL_CONFIG.valley.color };
    }
    return { value: 0.5, color: "#0f172a" };
  }

  hexToRgb(hex) {
    const normalized = hex.replace("#", "");
    const bigint = parseInt(normalized, 16);
    return {
      r: (bigint >> 16) & 255,
      g: (bigint >> 8) & 255,
      b: bigint & 255,
    };
  }

  extractColorPixels() {
    const image = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data;
    const rgb = new Float32Array(this.canvas.width * this.canvas.height * 3);
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
      rgb[i] = image[j];
      rgb[i + 1] = image[j + 1];
      rgb[i + 2] = image[j + 2];
    }
    return rgb;
  }

  getPostProcessOptions() {
    const normalizeResult = !!(this.settings?.normalizeResult);
    const blurAmount = clampPercentValue(
      typeof this.settings?.blurAmount === "number" ? this.settings.blurAmount : PAINT_HEIGHTMAP_DEFAULTS.blurAmount
    );
    return { normalizeResult, blurAmount };
  }

  updateSetting(name, value) {
    if (!this.settings) {
      this.settings = { ...PAINT_HEIGHTMAP_DEFAULTS };
    }
    this.settings[name] = value;
    if (name === "normalizeResult" || name === "blurAmount") {
      this.reprocessCurrentSketch();
    }
  }

  reprocessCurrentSketch() {
    if (!this.dataCanvas.width || !this.dataCanvas.height) {
      return;
    }
    const rgbPixels = this.extractColorPixels();
    if (!rgbPixels || !rgbPixels.length) {
      return;
    }
    const payload = {
      width: this.dataCanvas.width,
      height: this.dataCanvas.height,
      rgbPixels,
      ...this.getPostProcessOptions(),
    };
    this.runInference(payload);
  }

  runInference(payload) {
    if (!payload) return;
    const job = { ...payload, ...this.getPostProcessOptions() };
    queuePaintInference(this.nodeId, job, {
      onStatus: (state) => {
        if (state === "running") {
          this.setStatus("LinesToTerrain: Berechnung ...");
        } else if (state === "success") {
          this.setStatus("LinesToTerrain: Aktualisiert");
        } else if (state === "error") {
          this.setStatus("LinesToTerrain: Fehler");
        }
      },
      onComplete: (result) => {
        this.updateModelPreview(result);
        schedulePaintPreview(this.nodeId);
      },
    });
  }

  maybeAutoGenerate(settings) {
    if (this.autoQueued || settings.generatedHeightmap) {
      if (settings.generatedHeightmap) {
        this.updateModelPreview(settings.generatedHeightmap);
      }
      return;
    }
    const data = settings.canvasData;
    if (!data || !data.rgbPixels) {
      return;
    }
    this.autoQueued = true;
    this.runInference({ width: data.width, height: data.height, rgbPixels: data.rgbPixels });
  }

  setTool(tool) {
    if (!TOOL_CONFIG[tool]) return;
    this.tool = tool;
    updateHeightmapSettings(this.nodeId, { tool });
    this.syncToolbar();
  }

  setBrushSize(size) {
    this.brushSize = size;
  }

  syncToolbar() {
    if (!this.toolbar) return;
    const buttons = this.toolbar.querySelectorAll("[data-tool]");
    buttons.forEach((button) => {
      const value = button.getAttribute("data-tool");
      button.classList.toggle("is-active", value === this.tool);
    });
  }

  setStatus(text) {
    if (!this.statusEl) {
      this.statusEl = document.getElementById(`paintStatus-${this.nodeId}`);
    }
    if (this.statusEl) {
      this.statusEl.textContent = text || "";
    }
  }

  updateInputPreview(dataUrl) {
    const el = document.getElementById(`paintInputImg-${this.nodeId}`);
    if (!el) return;
    if (dataUrl) {
      el.src = dataUrl;
    } else {
      el.removeAttribute("src");
    }
  }

  updateModelPreview(result) {
    const el = document.getElementById(`paintModelImg-${this.nodeId}`);
    if (!el) return;
    if (!result || !result.pixels) {
      el.removeAttribute("src");
      return;
    }
    const width = result.width || this.canvas.width;
    const height = result.height || this.canvas.height;
    this.modelCanvas.width = width;
    this.modelCanvas.height = height;
    const ctx = this.modelCanvas.getContext("2d");
    const image = ctx.createImageData(width, height);
    for (let i = 0; i < result.pixels.length; i += 1) {
      const val = Math.max(0, Math.min(1, result.pixels[i]));
      const color = Math.round(val * 255);
      const idx = i * 4;
      image.data[idx] = color;
      image.data[idx + 1] = color;
      image.data[idx + 2] = color;
      image.data[idx + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    try {
      el.src = this.modelCanvas.toDataURL("image/png");
    } catch (error) {
      console.warn("Konnte LinesToTerrain Preview nicht rendern", error);
    }
  }
}
