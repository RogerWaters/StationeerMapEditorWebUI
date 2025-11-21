const workerUrl = self.location.href;
const rootUrl = new URL("../../..", workerUrl);
const ortWasmBase = new URL("vendor/onnxruntime/", rootUrl).href;
function resolveFromRoot(path) {
  return new URL(path, rootUrl).href;
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
  const normalized = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) {
    const value = inputArray[i];
    normalized[i] = Math.max(0, Math.min(255, Math.round(value || 0)));
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
  const inputStart = Date.now();
  const payload = normalizeRgbPayload(data.payload || {});
  const inputDuration = Date.now() - inputStart;
  try {
    await processInference(payload, messageId, inputDuration);
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

async function processInference(payload, messageId, inputDuration) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const ensureStart = Date.now();
      const model = await ensureModel();
      const ensureDuration = Date.now() - ensureStart;
      const inferenceStart = Date.now();
      const inference = await model.predict(payload);
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
