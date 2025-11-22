import {
  PAINT_HEIGHTMAP_DEFAULTS,
  getHeightmapById,
  projectState,
  updateHeightmapSettings,
} from "../state/projectState.js";
import { schedulePreview } from "../services/previewService.js";
import { buildPreviewTree } from "../services/previewBuilder.js";
import { runPaintModel } from "../services/paintModelService.js";

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

const TILE_SIZE = 512;
const TILE_OFFSETS = [
  { offsetX: 0, offsetY: 0 },
  { offsetX: -TILE_SIZE / 2, offsetY: 0 },
  { offsetX: 0, offsetY: -TILE_SIZE / 2 },
];

function getWorldCanvasSize() {
  const size = projectState.spec.size || TILE_SIZE;
  const clamped = Math.max(TILE_SIZE, size);
  return { width: clamped, height: clamped };
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
      hidden: true,
      disabled: true,
      height: 1,
      label: "",
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
        <div class="paint-toolbar-group">
          <label class="paint-toolbar-label" for="paintMaterial-${nodeId}">Material</label>
          <select id="paintMaterial-${nodeId}" class="paint-select" data-role="material">
            <option value="peak">Peak (Rot)</option>
            <option value="valley">Valley (Blau)</option>
            <option value="eraser">Erase (Schwarz)</option>
          </select>
        </div>
        <div class="paint-toolbar-group">
          <label class="paint-toolbar-label" for="paintTool-${nodeId}">Tool</label>
          <select id="paintTool-${nodeId}" class="paint-select" data-role="tool">
            <option value="brush">Brush</option>
            <option value="fill">Fill</option>
            <option value="rectangle">Rechteck</option>
            <option value="ellipse">Ellipse</option>
          </select>
        </div>
        <div class="paint-toolbar-group" data-role="brush-size-group">
          <label class="paint-toolbar-label" for="paintBrushSize-${nodeId}">Brush Size</label>
          <input id="paintBrushSize-${nodeId}" class="paint-input" type="number" min="1" max="10" step="0.25" data-role="brush-size" />
        </div>
        <div class="paint-toolbar-spacer"></div>
        <button type="button" class="paint-tool paint-tool-clear" data-action="clear">❌ Clear</button>
        <button type="button" class="paint-tool paint-tool-apply" data-action="apply">▶ Apply</button>
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
    updateSliderTooltip(getFieldId(nodeId, "brushSize"), `${brush}px (world)`);
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
    this.paintMode = PAINT_HEIGHTMAP_DEFAULTS.paintMode || "brush";
    this.paintMaterial = PAINT_HEIGHTMAP_DEFAULTS.paintMaterial || "peak";
    this.tool = this.paintMaterial;
    this.shapeType = PAINT_HEIGHTMAP_DEFAULTS.shapeType || "rectangle";
    this.brushSize = PAINT_HEIGHTMAP_DEFAULTS.brushSize;
    this.statusEl = document.getElementById(`paintStatus-${node.id}`);
    this.modelCanvas = document.createElement("canvas");
    this.settings = { ...PAINT_HEIGHTMAP_DEFAULTS };
    const { width, height } = getWorldCanvasSize();
    this.worldWidth = width;
    this.worldHeight = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.worldCanvas = document.createElement("canvas");
    this.worldCanvas.width = width;
    this.worldCanvas.height = height;
    this.worldCtx = this.worldCanvas.getContext("2d", { willReadFrequently: true });
    this.updateScaleFactors();
    this.tiledInferenceToken = 0;
    this.dirty = false;
    this.processingInference = false;
    this.applyButton = null;
    this.shapeStart = null;
    this.shapePreviewBase = null;
    this.attachToolbar();
    this.attachEvents();
    this.resetLayers();
    this.updateNode(node);
  }

  updateNode(node) {
    const settings = normalizeSettings(node);
    const { width, height } = getWorldCanvasSize();
    if (width !== this.worldWidth || height !== this.worldHeight) {
      this.worldWidth = width;
      this.worldHeight = height;
      this.canvas.width = width;
      this.canvas.height = height;
      this.worldCanvas.width = width;
      this.worldCanvas.height = height;
      this.worldCtx = this.worldCanvas.getContext("2d", { willReadFrequently: true });
      this.updateScaleFactors();
      this.resetLayers();
    }
    this.settings = { ...settings };
    this.paintMaterial = settings.paintMaterial || settings.tool || "peak";
    this.paintMode = settings.paintMode || "brush";
    this.shapeType = settings.shapeType || "rectangle";
    this.tool = this.paintMode === "brush" ? this.paintMaterial : this.paintMode;
    this.brushSize = settings.brushSize || PAINT_HEIGHTMAP_DEFAULTS.brushSize;
    this.syncToolbar();
    if (settings.canvasData?.displayUrl) {
      this.restoreDisplay(settings.canvasData.displayUrl);
      this.updateInputPreview(settings.canvasData.displayUrl);
    } else {
      this.resetLayers();
      this.setStatus("");
    }
    if (settings.canvasData?.pixels?.length) {
      this.restoreHeight(settings.canvasData);
    }
    if (settings.generatedHeightmap) {
      this.updateModelPreview(settings.generatedHeightmap);
      this.setStatus("LinesToTerrain: Aktualisiert");
    } else if (settings.canvasData?.pixels?.length) {
      this.markDirty("LinesToTerrain: Apply für neue Berechnung");
    }
  }

  attachToolbar() {
    this.toolbar = document.getElementById(`paintToolbar-${this.nodeId}`);
    if (!this.toolbar) return;
    this.materialSelect = this.toolbar.querySelector("[data-role='material']");
    this.toolSelect = this.toolbar.querySelector("[data-role='tool']");
    this.brushSizeInput = this.toolbar.querySelector("[data-role='brush-size']");
    this.brushSizeGroup = this.toolbar.querySelector("[data-role='brush-size-group']");
    this.toolbar.addEventListener("change", (event) => {
      const target = event.target;
      const role = target?.getAttribute("data-role");
      if (role === "material") {
        this.setMaterial(target.value);
      } else if (role === "tool") {
        this.setToolMode(target.value);
      } else if (role === "brush-size") {
        const numeric = parseFloat(target.value);
        const size = Number.isFinite(numeric) ? numeric : this.brushSize;
        this.setBrushSize(size);
      }
    });
    this.toolbar.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      const action = target.getAttribute("data-action");
      if (action === "clear") {
        this.clearCanvas();
      } else if (action === "apply") {
        this.handleApplyAction();
      }
    });
    this.syncToolbar();
    this.applyButton = this.toolbar.querySelector("[data-action='apply']");
    this.updateApplyButton();
  }

  attachEvents() {
    this.canvas.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.handlePointerUp(event));
    this.canvas.addEventListener("pointerleave", (event) => this.handlePointerUp(event));
  }

  handlePointerDown(event) {
    event.preventDefault();
    const displayPoint = this.getRelativePosition(event);
    const worldPoint = this.displayToWorld(displayPoint);
    if (this.paintMode === "fill") {
      const changed = this.handleFill(worldPoint);
      this.isDrawing = false;
      this.lastPoint = null;
      if (changed) {
        this.saveState();
      }
      return;
    }
    if (this.paintMode === "shape") {
      this.isDrawing = true;
      this.shapeStart = worldPoint;
      this.captureShapePreviewBase();
      this.renderShapePreview(worldPoint, worldPoint, this.shapeType === "ellipse");
      return;
    }
    this.isDrawing = true;
    this.lastPoint = worldPoint;
    this.drawPoint(worldPoint);
  }

  handlePointerMove(event) {
    if (!this.isDrawing) return;
    const displayPoint = this.getRelativePosition(event);
    const point = this.displayToWorld(displayPoint);
    if (this.paintMode === "shape") {
      this.renderShapePreview(this.shapeStart || point, point, this.shapeType === "ellipse");
      this.lastPoint = point;
      return;
    }
    this.drawLine(this.lastPoint, point);
    this.lastPoint = point;
  }

  handlePointerUp(event) {
    if (!this.isDrawing) return;
    event.preventDefault();
    if (this.paintMode === "shape" && this.shapeStart) {
      const displayPoint = this.getRelativePosition(event);
      const worldPoint = this.displayToWorld(displayPoint);
      this.commitShape(this.shapeStart, worldPoint, this.shapeType === "ellipse");
      this.shapeStart = null;
      this.shapePreviewBase = null;
    }
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
      this.drawPoint(to);
      return;
    }
    const color = this.getActiveColor();
    const displayBrush = Math.max(0.5, this.brushSize / this.worldScaleX);
    const worldBrush = Math.max(1, this.brushSize);
    const displayFrom = this.worldToDisplay(from);
    const displayTo = this.worldToDisplay(to);
    this.renderStroke(this.ctx, displayFrom, displayTo, displayBrush, color);
    this.renderStroke(this.worldCtx, from, to, worldBrush, color);
  }

  drawPoint(point) {
    if (!point) return;
    const color = this.getActiveColor();
    const displayBrush = Math.max(0.5, this.brushSize / this.worldScaleX);
    const worldBrush = Math.max(1, this.brushSize);
    const displayPoint = this.worldToDisplay(point);
    this.renderDot(this.ctx, displayPoint, displayBrush, color);
    this.renderDot(this.worldCtx, point, worldBrush, color);
  }

  renderStroke(ctx, from, to, width, color) {
    if (!from || !to) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  renderDot(ctx, point, width, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, width / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  displayToWorld(point) {
    return {
      x: Math.max(0, Math.min(this.worldWidth, point.x * this.worldScaleX)),
      y: Math.max(0, Math.min(this.worldHeight, point.y * this.worldScaleY)),
    };
  }

  worldToDisplay(point) {
    return {
      x: point.x / this.worldScaleX,
      y: point.y / this.worldScaleY,
    };
  }

  refreshDisplayFromWorld() {
    this.ctx.save();
    this.ctx.imageSmoothingEnabled = true;
    if (this.ctx.imageSmoothingQuality) {
      this.ctx.imageSmoothingQuality = "high";
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.worldCanvas, 0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  handleFill(worldPoint) {
    if (!worldPoint) return false;
    const color = this.hexToRgb(this.getActiveColor());
    const changed = this.floodFillWorld(worldPoint, color);
    if (changed) {
      this.refreshDisplayFromWorld();
    }
    return changed;
  }

  floodFillWorld(worldPoint, fillColor) {
    const x = Math.floor(worldPoint.x);
    const y = Math.floor(worldPoint.y);
    if (x < 0 || x >= this.worldWidth || y < 0 || y >= this.worldHeight) {
      return false;
    }
    const imageData = this.worldCtx.getImageData(0, 0, this.worldWidth, this.worldHeight);
    const data = imageData.data;
    const startIdx = (y * this.worldWidth + x) * 4;
    const startColor = {
      r: data[startIdx],
      g: data[startIdx + 1],
      b: data[startIdx + 2],
      a: data[startIdx + 3],
    };
    if (this.colorsClose(startColor, fillColor, 0)) {
      return false;
    }
    const tolerance = 5;
    const visited = new Uint8Array(this.worldWidth * this.worldHeight);
    const stack = [y * this.worldWidth + x];
    while (stack.length) {
      const idx = stack.pop();
      if (visited[idx]) continue;
      visited[idx] = 1;
      const base = idx * 4;
      const current = {
        r: data[base],
        g: data[base + 1],
        b: data[base + 2],
        a: data[base + 3],
      };
      if (!this.colorsClose(current, startColor, tolerance)) {
        continue;
      }
      data[base] = fillColor.r;
      data[base + 1] = fillColor.g;
      data[base + 2] = fillColor.b;
      data[base + 3] = 255;
      const px = idx % this.worldWidth;
      const py = (idx - px) / this.worldWidth;
      if (px > 0) stack.push(idx - 1);
      if (px + 1 < this.worldWidth) stack.push(idx + 1);
      if (py > 0) stack.push(idx - this.worldWidth);
      if (py + 1 < this.worldHeight) stack.push(idx + this.worldWidth);
    }
    this.worldCtx.putImageData(imageData, 0, 0);
    return true;
  }

  captureShapePreviewBase() {
    try {
      this.shapePreviewBase = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    } catch (error) {
      this.shapePreviewBase = null;
    }
  }

  restoreShapePreviewBase() {
    if (this.shapePreviewBase) {
      this.ctx.putImageData(this.shapePreviewBase, 0, 0);
      return true;
    }
    this.refreshDisplayFromWorld();
    return false;
  }

  renderShapePreview(start, end, asEllipse) {
    if (!start || !end) return;
    this.restoreShapePreviewBase();
    const color = this.getActiveColor();
    const a = this.worldToDisplay(start);
    const b = this.worldToDisplay(end);
    const rect = this.normalizeRect(a, b);
    const displayLineWidth = Math.max(0.5, this.brushSize / this.worldScaleX);
    const aligned = this.alignRectForStroke(rect, displayLineWidth);
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.setLineDash([6, 4]);
    this.ctx.lineWidth = displayLineWidth;
    this.ctx.lineJoin = "round";
    this.ctx.lineCap = "round";
    this.ctx.beginPath();
    if (asEllipse) {
      this.ctx.ellipse(aligned.x + aligned.w / 2, aligned.y + aligned.h / 2, aligned.w / 2, aligned.h / 2, 0, 0, Math.PI * 2);
    } else {
      this.ctx.rect(aligned.x, aligned.y, aligned.w, aligned.h);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  commitShape(start, end, asEllipse) {
    if (!start || !end) return;
    const color = this.getActiveColor();
    const rect = this.normalizeRect(start, end);
    this.drawShapeOnWorld(rect, color, asEllipse);
    this.drawShapeOnDisplay(rect, color, asEllipse);
    this.shapePreviewBase = null;
  }

  drawShapeOnWorld(rect, color, asEllipse) {
    if (!rect) return;
    const worldLineWidth = Math.max(1, this.brushSize);
    const aligned = this.alignRectForStroke(rect, worldLineWidth);
    this.worldCtx.save();
    this.worldCtx.strokeStyle = color;
    this.worldCtx.lineWidth = worldLineWidth;
    this.worldCtx.lineJoin = "round";
    this.worldCtx.lineCap = "round";
    this.worldCtx.beginPath();
    if (asEllipse) {
      this.worldCtx.ellipse(aligned.x + aligned.w / 2, aligned.y + aligned.h / 2, aligned.w / 2, aligned.h / 2, 0, 0, Math.PI * 2);
    } else {
      this.worldCtx.rect(aligned.x, aligned.y, aligned.w, aligned.h);
    }
    this.worldCtx.stroke();
    this.worldCtx.restore();
  }

  drawShapeOnDisplay(rect, color, asEllipse) {
    if (!rect) return;
    const a = this.worldToDisplay({ x: rect.x, y: rect.y });
    const b = this.worldToDisplay({ x: rect.x + rect.w, y: rect.y + rect.h });
    const dispRect = this.normalizeRect(a, b);
    const displayLineWidth = Math.max(0.5, this.brushSize / this.worldScaleX);
    const aligned = this.alignRectForStroke(dispRect, displayLineWidth);
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.setLineDash([]);
    this.ctx.lineWidth = displayLineWidth;
    this.ctx.lineJoin = "round";
    this.ctx.lineCap = "round";
    this.ctx.beginPath();
    if (asEllipse) {
      this.ctx.ellipse(
        aligned.x + aligned.w / 2,
        aligned.y + aligned.h / 2,
        aligned.w / 2,
        aligned.h / 2,
        0,
        0,
        Math.PI * 2
      );
    } else {
      this.ctx.rect(aligned.x, aligned.y, aligned.w, aligned.h);
    }
    this.ctx.stroke();
    this.ctx.restore();
  }

  alignRectForStroke(rect, lineWidth) {
    const offset = lineWidth % 2 === 0 ? 0 : 0.5;
    const x = Math.round(rect.x) + offset;
    const y = Math.round(rect.y) + offset;
    const w = Math.max(lineWidth, Math.round(rect.w));
    const h = Math.max(lineWidth, Math.round(rect.h));
    return { x, y, w, h };
  }

  normalizeRect(a, b) {
    const x1 = a?.x ?? 0;
    const y1 = a?.y ?? 0;
    const x2 = b?.x ?? 0;
    const y2 = b?.y ?? 0;
    const x = Math.min(x1, x2);
    const y = Math.min(y1, y2);
    return {
      x,
      y,
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
    };
  }

  colorsClose(a, b, tolerance = 0) {
    const tol = Math.max(0, tolerance);
    return (
      Math.abs((a?.r ?? 0) - (b?.r ?? 0)) <= tol &&
      Math.abs((a?.g ?? 0) - (b?.g ?? 0)) <= tol &&
      Math.abs((a?.b ?? 0) - (b?.b ?? 0)) <= tol
    );
  }

  clearCanvas() {
    this.resetLayers();
    this.saveState();
  }

  resetLayers() {
    this.ctx.fillStyle = "#000000";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.worldCtx.fillStyle = "#000000";
    this.worldCtx.fillRect(0, 0, this.worldWidth, this.worldHeight);
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
    const imageData = this.worldCtx.createImageData(width, height);
    for (let i = 0; i < pixels.length; i += 1) {
      const value = Math.max(0, Math.min(1, pixels[i]));
      const color = Math.round(value * 255);
      const idx = i * 4;
      imageData.data[idx] = color;
      imageData.data[idx + 1] = color;
      imageData.data[idx + 2] = color;
      imageData.data[idx + 3] = 255;
    }
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.putImageData(imageData, 0, 0);
    this.worldCtx.drawImage(tempCanvas, 0, 0, this.worldWidth, this.worldHeight);
    this.ctx.drawImage(tempCanvas, 0, 0, this.canvas.width, this.canvas.height);
  }

  extractFloatPixels() {
    if (!this.worldWidth || !this.worldHeight) {
      return new Float32Array(0);
    }
    const image = this.worldCtx.getImageData(0, 0, this.worldWidth, this.worldHeight).data;
    const floats = new Float32Array(this.worldWidth * this.worldHeight);
    for (let i = 0; i < floats.length; i += 1) {
      floats[i] = image[i * 4] / 255;
    }
    return floats;
  }

  saveState() {
    const pixels = this.extractFloatPixels();
    let dataUrl = null;
    try {
      dataUrl = this.canvas.toDataURL("image/png");
    } catch (error) {
      dataUrl = null;
    }
    this.updateInputPreview(dataUrl);
    updateHeightmapSettings(this.nodeId, {
      canvasData: {
        width: this.worldWidth,
        height: this.worldHeight,
        pixels,
        displayUrl: dataUrl,
      },
      brushSize: this.brushSize,
      tool: this.paintMaterial,
      paintMode: this.paintMode,
      paintMaterial: this.paintMaterial,
      shapeType: this.shapeType,
    });
    this.markDirty("LinesToTerrain: Zeichnung geändert – Apply klicken");
  }

  async runTiledInference() {
    if (!this.worldWidth || !this.worldHeight || this.processingInference) return null;
    this.processingInference = true;
    this.dirty = false;
    this.updateApplyButton();
    const token = ++this.tiledInferenceToken;
    const options = this.getPostProcessOptions();
    this.setStatus("LinesToTerrain: Berechnung ...");
    try {
      const result = await this.generateTiledHeightmap(options, token);
      if (this.tiledInferenceToken !== token || !result) return null;
      const payload = { ...result };
      updateHeightmapSettings(this.nodeId, { generatedHeightmap: payload });
      this.updateModelPreview(payload);
      schedulePaintPreview(this.nodeId);
      this.setStatus("LinesToTerrain: Aktualisiert");
      return payload;
    } catch (error) {
      if (this.tiledInferenceToken !== token) return null;
      this.dirty = true;
      this.markDirty("LinesToTerrain: Berechnung fehlgeschlagen – Apply erneut");
      console.error("LinesToTerrain Inferenz fehlgeschlagen", error);
      return null;
    } finally {
      this.processingInference = false;
      this.updateApplyButton();
    }
  }

  async generateTiledHeightmap(options, token) {
    const chunkSize = TILE_SIZE;
    const chunks = this.buildChunkList();
    if (!chunks.length) {
      return null;
    }
    const worldImage = this.worldCtx.getImageData(0, 0, this.worldWidth, this.worldHeight);
    const finalPixels = new Float32Array(this.worldWidth * this.worldHeight);
    const weightAccum = new Float32Array(finalPixels.length);
    const activeChunks = [];
    let completedChunks = 0;
    chunks.forEach((chunk) => {
      const { payload, buildDuration, hasContent } = this.buildChunkPayload(chunk, worldImage);
      if (!hasContent) {
        console.info(`[PaintHeightmap] skip empty chunk @(${chunk.originX},${chunk.originY})`);
        return;
      }
      activeChunks.push({ chunk, payload, buildDuration });
    });

    if (!activeChunks.length) {
      const flat = new Float32Array(this.worldWidth * this.worldHeight);
      flat.fill(0.5);
      return { width: this.worldWidth, height: this.worldHeight, pixels: flat };
    }

    const jobs = activeChunks.map(({ chunk, payload, buildDuration }, index) => {
      const chunkNumber = index + 1;
      const jobPayload = { ...payload, ...options };
      const meta = {
        chunkNumber,
        originX: chunk.originX,
        originY: chunk.originY,
        buildDuration,
      };
      console.info(`[PaintHeightmap] chunk payload build ${chunkNumber}/${chunks.length} ${buildDuration.toFixed(1)}ms`, meta);
      this.reportChunkStatus(chunkNumber, activeChunks.length, chunk, "queued");
      return runPaintModel(jobPayload, meta)
        .then((result) => {
          if (this.tiledInferenceToken !== token || !result) {
            return;
          }
          this.blendChunkResult(result, chunk, finalPixels, weightAccum);
          completedChunks += 1;
          this.reportChunkStatus(chunkNumber, activeChunks.length, chunk, "completed", { completed: completedChunks });
        })
        .catch((error) => {
          console.error("Chunk Inferenz fehlgeschlagen", error);
          throw error;
        });
    });
    await Promise.all(jobs);
    if (this.tiledInferenceToken !== token) {
      return null;
    }
    this.setStatus("LinesToTerrain: Zusammenführung der Chunks ...");
    console.log(`[PaintHeightmap] blending ${activeChunks.length} chunks`);
    const averaged = new Float32Array(finalPixels.length);
    let hasData = false;
    for (let i = 0; i < finalPixels.length; i += 1) {
      const weight = weightAccum[i];
      if (weight > 0) {
        averaged[i] = Math.max(0, Math.min(1, finalPixels[i] / weight));
        hasData = true;
      } else {
        averaged[i] = Number.NaN;
      }
    }
    if (!hasData) {
      averaged.fill(0.5);
      return { width: this.worldWidth, height: this.worldHeight, pixels: averaged };
    }
    const { pixels: filled, filledMask } = this.fillMissingPixels(averaged, weightAccum, this.worldWidth, this.worldHeight, 0.5);
    const softened = this.blurFilledPixels(filled, filledMask, this.worldWidth, this.worldHeight);
    const processed = this.applyFinalPostProcess(softened, options);
    return { width: this.worldWidth, height: this.worldHeight, pixels: processed };
  }

  buildChunkList() {
    const chunkSize = TILE_SIZE;
    const list = [];
    TILE_OFFSETS.forEach(({ offsetX, offsetY }) => {
      for (let y = offsetY; y < this.worldHeight; y += chunkSize) {
        if (y + chunkSize <= 0) {
          continue;
        }
        for (let x = offsetX; x < this.worldWidth; x += chunkSize) {
          if (x + chunkSize <= 0) {
            continue;
          }
          list.push({ originX: Math.floor(x), originY: Math.floor(y) });
        }
      }
    });
    return list;
  }

  buildChunkPayload(chunk, worldImage) {
    const chunkSize = TILE_SIZE;
    const start = performance.now();
    const rgbPixels = new Float32Array(chunkSize * chunkSize * 3);
    const data = worldImage.data;
    const { originX, originY } = chunk;
    let hasContent = false;
    for (let row = 0; row < chunkSize; row += 1) {
      const worldY = originY + row;
      const rowInBounds = worldY >= 0 && worldY < this.worldHeight;
      for (let col = 0; col < chunkSize; col += 1) {
        const worldX = originX + col;
        const destIdx = (row * chunkSize + col) * 3;
        if (!rowInBounds || worldX < 0 || worldX >= this.worldWidth) {
          rgbPixels[destIdx] = 0;
          rgbPixels[destIdx + 1] = 0;
          rgbPixels[destIdx + 2] = 0;
          continue;
        }
        const srcIdx = (worldY * this.worldWidth + worldX) * 4;
        const r = data[srcIdx];
        const g = data[srcIdx + 1];
        const b = data[srcIdx + 2];
        rgbPixels[destIdx] = r;
        rgbPixels[destIdx + 1] = g;
        rgbPixels[destIdx + 2] = b;
        if (!hasContent && (r !== 0 || g !== 0 || b !== 0)) {
          hasContent = true;
        }
      }
    }
    const duration = performance.now() - start;
    return { payload: { width: chunkSize, height: chunkSize, rgbPixels }, buildDuration: duration, hasContent };
  }

  blendChunkResult(result, chunk, finalPixels, weightAccum) {
    const chunkWidth = result.width || TILE_SIZE;
    const chunkHeight = result.height || TILE_SIZE;
    const pixels = result.pixels;
    const { originX, originY } = chunk;
    for (let row = 0; row < chunkHeight; row += 1) {
      const worldY = originY + row;
      if (worldY < 0 || worldY >= this.worldHeight) continue;
      const baseIdx = worldY * this.worldWidth;
      const weightY = this.computeWeight(row, chunkHeight);
      if (weightY <= 0) continue;
      for (let col = 0; col < chunkWidth; col += 1) {
        const worldX = originX + col;
        if (worldX < 0 || worldX >= this.worldWidth) continue;
        const weightX = this.computeWeight(col, chunkWidth);
        if (weightX <= 0) continue;
        const weight = weightX * weightY;
        const idx = baseIdx + worldX;
        const value = Math.max(0, Math.min(1, pixels[row * chunkWidth + col]));
        finalPixels[idx] += value * weight;
        weightAccum[idx] += weight;
      }
    }
  }

  computeWeight(position, size) {
    if (size <= 1) {
      return 1;
    }
    const center = (size - 1) / 2;
    const normalized = (position - center) / center;
    return Math.max(0, 1 - Math.min(1, Math.abs(normalized)));
  }

  applyFinalPostProcess(pixels, options) {
    const result = new Float32Array(pixels);
    if (options.normalizeResult) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < result.length; i += 1) {
        const value = result[i];
        if (value < min) min = value;
        if (value > max) max = value;
      }
      const range = max - min || 1;
      for (let i = 0; i < result.length; i += 1) {
        result[i] = (result[i] - min) / range;
      }
    }
    const blurPercent = clampPercentValue(options.blurAmount ?? PAINT_HEIGHTMAP_DEFAULTS.blurAmount);
    const blurFactor = Math.max(0, Math.min(1, blurPercent / 100));
    if (blurFactor > 0) {
      const blurred = this.blurFloat3x3(result, this.worldWidth, this.worldHeight);
      for (let i = 0; i < result.length; i += 1) {
        result[i] = result[i] * (1 - blurFactor) + blurred[i] * blurFactor;
      }
    }
    return result;
  }

  fillMissingPixels(values, weights, width, height, fallback = 0.5) {
    const total = width * height;
    const result = new Float32Array(values);
    const seedMask = new Uint8Array(total);
    const filledMask = new Uint8Array(total);
    const visited = new Uint8Array(total);
    const queue = new Uint32Array(total);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < total; i += 1) {
      if (weights[i] > 0 && Number.isFinite(values[i])) {
        visited[i] = 1;
        seedMask[i] = 1;
        queue[tail] = i;
        tail += 1;
      }
    }
    if (tail === 0) {
      result.fill(fallback);
      filledMask.fill(1);
      return { pixels: result, filledMask };
    }
    while (head < tail) {
      const idx = queue[head];
      head += 1;
      const val = result[idx];
      const x = idx % width;
      const y = (idx - x) / width;
      const left = idx - 1;
      const right = idx + 1;
      const up = idx - width;
      const down = idx + width;
      if (x > 0 && !visited[left]) {
        visited[left] = 1;
        result[left] = val;
        if (!seedMask[left]) filledMask[left] = 1;
        queue[tail] = left;
        tail += 1;
      }
      if (x + 1 < width && !visited[right]) {
        visited[right] = 1;
        result[right] = val;
        if (!seedMask[right]) filledMask[right] = 1;
        queue[tail] = right;
        tail += 1;
      }
      if (y > 0 && !visited[up]) {
        visited[up] = 1;
        result[up] = val;
        if (!seedMask[up]) filledMask[up] = 1;
        queue[tail] = up;
        tail += 1;
      }
      if (y + 1 < height && !visited[down]) {
        visited[down] = 1;
        result[down] = val;
        if (!seedMask[down]) filledMask[down] = 1;
        queue[tail] = down;
        tail += 1;
      }
    }
    for (let i = 0; i < total; i += 1) {
      if (!visited[i]) {
        result[i] = fallback;
        filledMask[i] = 1;
      }
    }
    return { pixels: result, filledMask };
  }

  blurFilledPixels(values, filledMask, width, height) {
    if (!filledMask || !filledMask.length) return values;
    const blurred = this.blurFloat3x3(values, width, height);
    const result = new Float32Array(values);
    for (let i = 0; i < result.length; i += 1) {
      if (filledMask[i]) {
        result[i] = blurred[i];
      }
    }
    return result;
  }

  blurFloat3x3(values, width, height) {
    const result = new Float32Array(values.length);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let samples = 0;
        for (let ky = -1; ky <= 1; ky += 1) {
          const ny = Math.min(height - 1, Math.max(0, y + ky));
          for (let kx = -1; kx <= 1; kx += 1) {
            const nx = Math.min(width - 1, Math.max(0, x + kx));
            sum += values[ny * width + nx];
            samples += 1;
          }
        }
        result[y * width + x] = sum / samples;
      }
    }
    return result;
  }

  reportChunkStatus(current, total, chunk, stage = "processing", meta = {}) {
    const offsetLabel = chunk ? `@(${chunk.originX},${chunk.originY})` : "";
    let message = "";
    if (stage === "queued") {
      message = `LinesToTerrain: Chunk ${current}/${total} gestartet ${offsetLabel}`;
    } else if (stage === "completed") {
      const completed = meta.completed || current;
      message = `LinesToTerrain: Chunk ${current}/${total} abgeschlossen (${completed}/${total}) ${offsetLabel}`;
    } else {
      message = `LinesToTerrain: Chunk ${current}/${total} ${offsetLabel}`;
    }
    this.setStatus(message);
    console.log(`[PaintHeightmap] ${message}`);
  }

  applySketchImage(imageData) {
    if (!imageData) return;
    const { width, height, data } = imageData;
    if (!width || !height) return;
    const display = this.ctx.createImageData(this.canvas.width, this.canvas.height);
    const renderCanvas = document.createElement("canvas");
    renderCanvas.width = this.canvas.width;
    renderCanvas.height = this.canvas.height;
    const renderCtx = renderCanvas.getContext("2d");
    const renderData = renderCtx.createImageData(this.canvas.width, this.canvas.height);
    const targetWidth = Math.min(width, this.canvas.width);
    const targetHeight = Math.min(height, this.canvas.height);
    for (let y = 0; y < targetHeight; y += 1) {
      for (let x = 0; x < targetWidth; x += 1) {
        const srcIdx = (y * width + x) * 4;
        const { color } = this.interpretSketchPixel(data[srcIdx], data[srcIdx + 1], data[srcIdx + 2]);
        const dstIdx = (y * this.canvas.width + x) * 4;
        const rgb = this.hexToRgb(color);
        display.data[dstIdx] = rgb.r;
        display.data[dstIdx + 1] = rgb.g;
        display.data[dstIdx + 2] = rgb.b;
        display.data[dstIdx + 3] = 255;
        renderData.data[dstIdx] = rgb.r;
        renderData.data[dstIdx + 1] = rgb.g;
        renderData.data[dstIdx + 2] = rgb.b;
        renderData.data[dstIdx + 3] = 255;
      }
    }
    this.ctx.putImageData(display, 0, 0);
    renderCtx.putImageData(renderData, 0, 0);
    this.worldCtx.drawImage(renderCanvas, 0, 0, this.worldWidth, this.worldHeight);
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

  getPostProcessOptions() {
    const normalizeResult = !!(this.settings?.normalizeResult);
    const blurAmount = clampPercentValue(
      typeof this.settings?.blurAmount === "number" ? this.settings.blurAmount : PAINT_HEIGHTMAP_DEFAULTS.blurAmount
    );
    return { normalizeResult, blurAmount };
  }

  updateScaleFactors() {
    this.worldScaleX = this.worldWidth / this.canvas.width;
    this.worldScaleY = this.worldHeight / this.canvas.height;
    this.worldScale = Math.max(1, (this.worldScaleX + this.worldScaleY) / 2);
  }

  updateSetting(name, value) {
    if (!this.settings) {
      this.settings = { ...PAINT_HEIGHTMAP_DEFAULTS };
    }
    this.settings[name] = value;
    this.markDirty("LinesToTerrain: Einstellungen geändert – Apply klicken");
  }

  setMaterial(material) {
    if (!TOOL_CONFIG[material]) return;
    this.paintMaterial = material;
    if (this.paintMode === "brush") {
      this.tool = material;
    }
    updateHeightmapSettings(this.nodeId, {
      tool: this.paintMaterial,
      paintMode: this.paintMode,
      paintMaterial: this.paintMaterial,
      shapeType: this.shapeType,
    });
    this.syncToolbar();
    this.markDirty("LinesToTerrain: Material geändert – Apply klicken");
  }

  setToolMode(mode) {
    if (mode === "brush") {
      this.paintMode = "brush";
      this.tool = this.paintMaterial;
    } else if (mode === "fill") {
      this.paintMode = "fill";
      this.tool = "fill";
    } else if (mode === "rectangle" || mode === "ellipse") {
      this.paintMode = "shape";
      this.shapeType = mode;
      this.tool = "shape";
    } else {
      return;
    }
    this.shapeStart = null;
    updateHeightmapSettings(this.nodeId, {
      tool: this.paintMaterial,
      paintMode: this.paintMode,
      paintMaterial: this.paintMaterial,
      shapeType: this.shapeType,
    });
    this.syncToolbar();
    this.markDirty("LinesToTerrain: Werkzeug geändert – Apply klicken");
  }

  setBrushSize(size) {
    this.brushSize = size;
    updateHeightmapSettings(this.nodeId, { brushSize: size });
    updateSliderTooltip(getFieldId(this.nodeId, "brushSize"), `${size}px (world)`);
    this.syncToolbar();
    this.markDirty("LinesToTerrain: Pinselgröße geändert – Apply klicken");
  }

  syncToolbar() {
    if (!this.toolbar) return;
    if (this.materialSelect) {
      this.materialSelect.value = this.paintMaterial || "peak";
    }
    if (this.toolSelect) {
      const toolValue =
        this.paintMode === "brush"
          ? "brush"
          : this.paintMode === "fill"
            ? "fill"
            : this.shapeType === "ellipse"
              ? "ellipse"
              : "rectangle";
      this.toolSelect.value = toolValue;
    }
    const isFill = this.paintMode === "fill";
    if (this.brushSizeInput) {
      this.brushSizeInput.value = this.brushSize;
      this.brushSizeInput.disabled = isFill;
    }
    if (this.brushSizeGroup) {
      this.brushSizeGroup.classList.toggle("is-disabled", isFill);
    }
  }

  getActiveColor() {
    const key = this.paintMaterial || "peak";
    return (TOOL_CONFIG[key] && TOOL_CONFIG[key].color) || "#ff0000";
  }

  setStatus(text) {
    if (!this.statusEl) {
      this.statusEl = document.getElementById(`paintStatus-${this.nodeId}`);
    }
    if (this.statusEl) {
      this.statusEl.textContent = text || "";
    }
  }

  markDirty(message) {
    this.dirty = true;
    this.updateApplyButton();
    if (message) {
      this.setStatus(message);
      return;
    }
    if (!this.processingInference) {
      this.setStatus("LinesToTerrain: Änderungen vorhanden – Apply klicken");
    }
  }

  updateApplyButton() {
    if (!this.applyButton) return;
    this.applyButton.disabled = this.processingInference || !this.dirty;
  }

  handleApplyAction() {
    if (this.processingInference || !this.dirty) return;
    this.runTiledInference();
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
    const width = result.width || this.worldWidth;
    const height = result.height || this.worldHeight;
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
