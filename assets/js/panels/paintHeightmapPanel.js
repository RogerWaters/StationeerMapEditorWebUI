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
    this.tool = "peak";
    this.brushSize = PAINT_HEIGHTMAP_DEFAULTS.brushSize;
    this.statusEl = document.getElementById(`paintStatus-${node.id}`);
    this.modelCanvas = document.createElement("canvas");
    this.settings = { ...PAINT_HEIGHTMAP_DEFAULTS };
    const { width, height } = getWorldCanvasSize();
    this.worldWidth = width;
    this.worldHeight = height;
    this.worldCanvas = document.createElement("canvas");
    this.worldCanvas.width = width;
    this.worldCanvas.height = height;
    this.worldCtx = this.worldCanvas.getContext("2d", { willReadFrequently: true });
    this.updateScaleFactors();
    this.tiledInferenceToken = 0;
    this.dirty = false;
    this.processingInference = false;
    this.applyButton = null;
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
      this.worldCanvas.width = width;
      this.worldCanvas.height = height;
      this.worldCtx = this.worldCanvas.getContext("2d", { willReadFrequently: true });
      this.updateScaleFactors();
      this.resetLayers();
    }
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
    this.toolbar.addEventListener("click", (event) => {
      const target = event.target.closest("button");
      if (!target) return;
      const tool = target.getAttribute("data-tool");
      const action = target.getAttribute("data-action");
      if (tool && TOOL_CONFIG[tool]) {
        this.setTool(tool);
      } else if (action === "clear") {
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
    this.isDrawing = true;
    const displayPoint = this.getRelativePosition(event);
    const worldPoint = this.displayToWorld(displayPoint);
    this.lastPoint = worldPoint;
    this.drawPoint(worldPoint);
  }

  handlePointerMove(event) {
    if (!this.isDrawing) return;
    const displayPoint = this.getRelativePosition(event);
    const point = this.displayToWorld(displayPoint);
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
      this.drawPoint(to);
      return;
    }
    const color = TOOL_CONFIG[this.tool].color;
    const displayFrom = this.worldToDisplay(from);
    const displayTo = this.worldToDisplay(to);
    this.renderStroke(this.ctx, displayFrom, displayTo, this.brushSize, color);
    const worldBrush = Math.max(1, this.brushSize * this.worldScale);
    this.renderStroke(this.worldCtx, from, to, worldBrush, color);
  }

  drawPoint(point) {
    if (!point) return;
    const color = TOOL_CONFIG[this.tool].color;
    const displayPoint = this.worldToDisplay(point);
    const worldBrush = Math.max(1, this.brushSize * this.worldScale);
    this.renderDot(this.ctx, displayPoint, this.brushSize, color);
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
      tool: this.tool,
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
    let completedChunks = 0;
    const jobs = chunks.map((chunk, index) => {
      const chunkNumber = index + 1;
      const { payload, buildDuration } = this.buildChunkPayload(chunk, worldImage);
      const jobPayload = { ...payload, ...options };
      const meta = {
        chunkNumber,
        originX: chunk.originX,
        originY: chunk.originY,
        buildDuration,
      };
      console.info(`[PaintHeightmap] chunk payload build ${chunkNumber}/${chunks.length} ${buildDuration.toFixed(1)}ms`, meta);
      this.reportChunkStatus(chunkNumber, chunks.length, chunk, "queued");
      return runPaintModel(jobPayload, meta)
        .then((result) => {
          if (this.tiledInferenceToken !== token || !result) {
            return;
          }
          this.blendChunkResult(result, chunk, finalPixels, weightAccum);
          completedChunks += 1;
          this.reportChunkStatus(chunkNumber, chunks.length, chunk, "completed", { completed: completedChunks });
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
    console.log(`[PaintHeightmap] blending ${chunks.length} chunks`);
    for (let i = 0; i < finalPixels.length; i += 1) {
      const weight = weightAccum[i];
      finalPixels[i] = weight > 0 ? Math.max(0, Math.min(1, finalPixels[i] / weight)) : 0.5;
    }
    const processed = this.applyFinalPostProcess(finalPixels, options);
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
        rgbPixels[destIdx] = data[srcIdx];
        rgbPixels[destIdx + 1] = data[srcIdx + 1];
        rgbPixels[destIdx + 2] = data[srcIdx + 2];
      }
    }
    const duration = performance.now() - start;
    return { payload: { width: chunkSize, height: chunkSize, rgbPixels }, buildDuration: duration };
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

  setTool(tool) {
    if (!TOOL_CONFIG[tool]) return;
    this.tool = tool;
    updateHeightmapSettings(this.nodeId, { tool });
    this.syncToolbar();
    this.markDirty("LinesToTerrain: Werkzeug geändert – Apply klicken");
  }

  setBrushSize(size) {
    this.brushSize = size;
    this.markDirty("LinesToTerrain: Pinselgröße geändert – Apply klicken");
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
