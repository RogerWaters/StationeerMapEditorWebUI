const workerUrl = self.location.href;
const rootUrl = new URL("../../..", workerUrl);
const ortWasmBase = new URL("vendor/onnxruntime/", rootUrl).href;
function resolveFromRoot(path) {
  return new URL(path, rootUrl).href;
}

const INPUT_SIZE = 512;

function canvasFromSize(width, height) {
  if (typeof document !== "undefined" && document.createElement) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  throw new Error("Unable to create a canvas in this environment.");
}

function isImageDataLike(value) {
  return value && typeof value.width === "number" && typeof value.height === "number" && value.data;
}

function hasDomCanvas(value) {
  return typeof HTMLCanvasElement !== "undefined" && value instanceof HTMLCanvasElement;
}

function hasDomImage(value) {
  return (typeof HTMLImageElement !== "undefined" && value instanceof HTMLImageElement) || (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap);
}

function toTypedArray(data) {
  if (ArrayBuffer.isView(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Uint8Array.from(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  throw new Error("Unsupported pixel data container.");
}

function getPixelsFromSource(source) {
  if (isImageDataLike(source)) {
    return source;
  }
  if (hasDomCanvas(source)) {
    const ctx = source.getContext("2d");
    return ctx.getImageData(0, 0, source.width, source.height);
  }
  if (hasDomImage(source)) {
    const canvas = canvasFromSize(INPUT_SIZE, INPUT_SIZE);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(source, 0, 0, INPUT_SIZE, INPUT_SIZE);
    return ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  }
  if (source && source.data && typeof source.width === "number" && typeof source.height === "number") {
    return source;
  }
  throw new Error("Unsupported image source. Provide ImageData, Canvas, ImageBitmap, or an object with width/height/data.");
}

function prepareInputPixels(source) {
  const pixels = getPixelsFromSource(source);
  let { width, height } = pixels;
  let data = toTypedArray(pixels.data);

  if (width !== INPUT_SIZE || height !== INPUT_SIZE) {
    if (typeof document === "undefined" && typeof OffscreenCanvas === "undefined") {
      throw new Error("Input must be 512x512 when canvas APIs are unavailable.");
    }
    const canvas = canvasFromSize(INPUT_SIZE, INPUT_SIZE);
    const ctx = canvas.getContext("2d");
    const imageData = new ImageData(new Uint8ClampedArray(data.buffer.slice(0, width * height * 4)), width, height);
    ctx.putImageData(imageData, 0, 0);
    const resized = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    width = INPUT_SIZE;
    height = INPUT_SIZE;
    data = resized.data;
  }

  const channels = Math.round(data.length / (width * height));
  if (channels !== 3 && channels !== 4) {
    throw new Error("Expected image data with 3 or 4 channels.");
  }

  const rgb = new Float32Array(width * height * 3);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += channels) {
    rgb[i] = data[j];
    rgb[i + 1] = data[j + 1];
    rgb[i + 2] = data[j + 2];
  }
  return { width, height, data: rgb };
}

function rgbToGray16(rgb) {
  const pixels = rgb.length / 3;
  const gray = new Float32Array(pixels);
  const scale = 0xffff / 255;
  for (let i = 0, j = 0; i < pixels; i += 1, j += 3) {
    const g = 0.2989 * rgb[j] + 0.587 * rgb[j + 1] + 0.114 * rgb[j + 2];
    gray[i] = g * scale;
  }
  return gray;
}

function applyLevels(buffer) {
  const out = new Float32Array(buffer.length);
  const invRange = 1 / (60395 - 5140);
  for (let i = 0; i < buffer.length; i += 1) {
    let value = (buffer[i] - 5140) * invRange;
    value = Math.max(0, Math.min(1, value));
    out[i] = value * 0xffff;
  }
  return out;
}

function boxBlur3x3(buffer, width, height) {
  const out = new Float32Array(buffer.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let acc = 0;
      for (let ky = -1; ky <= 1; ky += 1) {
        const ny = Math.min(height - 1, Math.max(0, y + ky));
        for (let kx = -1; kx <= 1; kx += 1) {
          const nx = Math.min(width - 1, Math.max(0, x + kx));
          acc += buffer[ny * width + nx];
        }
      }
      out[y * width + x] = acc / 9;
    }
  }
  return out;
}

function toUint16(buffer) {
  const out = new Uint16Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    const value = Math.round(Math.max(0, Math.min(0xffff, buffer[i])));
    out[i] = value;
  }
  return out;
}

function supportsWebGPU() {
  return typeof navigator === "object" && !!navigator?.gpu;
}

function supportsWebGL() {
  if (typeof OffscreenCanvas === "undefined") {
    return false;
  }
  try {
    const canvas = new OffscreenCanvas(1, 1);
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    return !!gl;
  } catch {
    return false;
  }
}

function detectExecutionProviders() {
  const providers = [];
  if (supportsWebGPU()) {
    providers.push("webgpu");
  }
  if (supportsWebGL()) {
    providers.push("webgl");
  }
  providers.push("wasm");
  self.postMessage({
    type: "debug",
    level: "info",
    message: `Execution providers detected: ${providers.join(", ")}`,
  });
  return providers;
}

const wasmLoadStart = Date.now();
self.importScripts(
  resolveFromRoot("vendor/onnxruntime/ort.min.js"),
  resolveFromRoot("vendor/linesToTerrain/linesToTerrain.js")
);
const wasmLoadDuration = Date.now() - wasmLoadStart;
self.postMessage({
  type: "debug",
  level: "info",
  message: `WASM geladen in ${wasmLoadDuration}ms`,
});
let executionProviders = detectExecutionProviders();

const MODEL_URL = resolveFromRoot("vendor/models/linesToTerrain/mountain.manifest.json");
let modelPromise = null;
let modelLoadDuration = 0;
let selectedProvider = null;

function configureExecutionEnv(provider, ort) {
  if (!ort?.env) {
    return;
  }
  if (provider === "wasm" && ort.env.wasm) {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    ort.env.wasm.wasmPaths = ortWasmBase;
  }
  if (provider === "webgl" && ort.env.webgl) {
    ort.env.webgl.enableSimd = true;
  }
  if (provider === "webgpu" && ort.env.webgpu) {
    ort.env.webgpu.enableWebGPUAsync = true;
  }
}

function fallbackToWasmProvider() {
  executionProviders = ["wasm"];
  modelPromise = null;
  selectedProvider = null;
  self.postMessage({
    type: "debug",
    level: "warning",
    message: "WebGL/WebGPU-Probleme erkannt, fall back auf WASM.",
  });
}

async function loadModelWithProviders() {
  const api = self.LinesToTerrain;
  if (!api || !api.LinesToTerrainModel) {
    throw new Error("LinesToTerrain API fehlt im Worker.");
  }
  const ort = self.ort;
  if (!ort) {
    throw new Error("ONNX Runtime im Worker nicht verfügbar.");
  }
  const candidates = executionProviders.length ? executionProviders : ["wasm"];
  let lastError = null;
  for (const provider of candidates) {
    try {
      configureExecutionEnv(provider, ort);
      const sessionOptions = { executionProviders: [provider] };
      const instance = new api.LinesToTerrainModel({
        modelUrl: MODEL_URL,
        ort,
        sessionOptions,
      });
      const modelLoadStart = Date.now();
      await instance.load();
      selectedProvider = provider;
      modelLoadDuration = Date.now() - modelLoadStart;
      self.postMessage({
        type: "debug",
        level: "info",
        message: `LinesToTerrain-Modell geladen (${provider}) in ${modelLoadDuration}ms`,
      });
      return instance;
    } catch (error) {
      lastError = error;
      self.postMessage({
        type: "debug",
        level: "warning",
        message: `Execution provider '${provider}' konnte nicht geladen werden: ${error?.message || String(error)}`,
      });
    }
  }
  throw lastError || new Error("Keine Execution Provider verfügbar.");
}

function ensureModel() {
  if (!modelPromise) {
    modelPromise = loadModelWithProviders().catch((error) => {
      modelPromise = null;
      throw error;
    });
  }
  return modelPromise;
}

async function runInferenceWithPrepared(model, prepared, provider) {
  const dims = provider === "wasm" ? [prepared.height, prepared.width, 3] : [1, prepared.height, prepared.width, 3];
  const tensor = new model.ort.Tensor("float32", prepared.data, dims);
  const feeds = { "browser_input:0": tensor };
  const results = await model.session.run(feeds);
  const rgbTensor = results["browser_output:0"];
  const rgbData = rgbTensor.data instanceof Uint8Array ? rgbTensor.data : Uint8Array.from(rgbTensor.data);
  const gray16 = rgbToGray16(rgbData);
  const leveled = applyLevels(gray16);
  const blurred = boxBlur3x3(leveled, INPUT_SIZE, INPUT_SIZE);
  const uint16 = toUint16(blurred);
  return { width: INPUT_SIZE, height: INPUT_SIZE, data: uint16 };
}

function normalizeRgbPayload(payload) {
  const width = payload?.width;
  const height = payload?.height;
  const rgbPixels = payload?.rgbPixels;
  if (!width || !height || !rgbPixels) {
    throw new Error("Ungültige Sketchdaten für LinesToTerrain.");
  }
  const length = width * height * 3;
  const inputArray = ArrayBuffer.isView(rgbPixels) ? rgbPixels : new Float32Array(rgbPixels);
  if (inputArray.length < length) {
    throw new Error("Unvollständige Sketchdaten empfangen.");
  }
  const normalized = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const value = inputArray[i];
    normalized[i] = Math.max(0, Math.min(255, value || 0));
  }
  return { width, height, data: normalized };
}

function clampPercent(value) {
  const numeric = parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(100, numeric));
}

function prepareResult(result, options = {}) {
  const width = result.width;
  const height = result.height;
  const data = result.data instanceof Uint16Array ? result.data : new Uint16Array(result.data || []);
  const floats = new Float32Array(data.length);
  const invMax = 1 / 0xffff;
  for (let i = 0; i < data.length; i += 1) {
    floats[i] = data[i] * invMax;
  }
  if (options.normalizeResult) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < floats.length; i += 1) {
      const value = floats[i];
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const range = max - min || 1;
    for (let i = 0; i < floats.length; i += 1) {
      floats[i] = (floats[i] - min) / range;
    }
  }
  const blurFactor = Math.max(0, Math.min(1, clampPercent(options.blurAmount) / 100));
  if (blurFactor > 0) {
    const blurred = blurFloat3x3(floats, width, height);
    for (let i = 0; i < floats.length; i += 1) {
      floats[i] = floats[i] * (1 - blurFactor) + blurred[i] * blurFactor;
    }
  }
  return { width, height, pixels: floats };
}

function blurFloat3x3(values, width, height) {
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

self.onmessage = async (event) => {
  const { data } = event;
  if (!data || data.type !== "infer") {
    return;
  }
  const messageId = data.id;
  const payload = normalizeRgbPayload(data.payload || {});
  try {
    await processInference(payload, messageId);
  } catch (error) {
    self.postMessage({
      type: "debug",
      level: "error",
      message: error?.message || String(error),
    });
    self.postMessage({
      id: messageId,
      ok: false,
      error: error?.message || String(error),
      stack: error?.stack || null,
    });
  }
};

async function processInference(payload, messageId) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const ensureStart = Date.now();
      const model = await ensureModel();
      const ensureDuration = Date.now() - ensureStart;
      const inputStart = Date.now();
      const prepared = prepareInputPixels({ width: payload.width, height: payload.height, data: payload.data });
      const inputDuration = Date.now() - inputStart;
      const inferenceStart = Date.now();
      const inference = await runInferenceWithPrepared(model, prepared, selectedProvider || "wasm");
      const inferenceDuration = Date.now() - inferenceStart;
      const resultStart = Date.now();
      const normalized = prepareResult(inference, {
        normalizeResult: false,
        blurAmount: 0,
      });
      const resultDuration = Date.now() - resultStart;
      const timings = {
        wasmLoad: wasmLoadDuration,
        modelLoad: modelLoadDuration,
        ensureModel: ensureDuration,
        inputPrep: inputDuration,
        inference: inferenceDuration,
        resultPrep: resultDuration,
        provider: selectedProvider || "unknown",
      };
      self.postMessage({
        type: "debug",
        level: "info",
        message: `Chunk-Timings ${payload.width}x${payload.height}`,
        timings,
      });
      const buffer = normalized.pixels.buffer;
      self.postMessage({ id: messageId, ok: true, width: normalized.width, height: normalized.height, buffer }, [buffer]);
      return;
    } catch (error) {
      lastError = error;
      if (selectedProvider !== "wasm") {
        fallbackToWasmProvider();
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}
