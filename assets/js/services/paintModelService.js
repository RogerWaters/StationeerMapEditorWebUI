import { updateHeightmapSettings } from "../state/projectState.js";

const pendingJobs = new Map();
const workerResponses = new Map();
let workerInstance = null;
let workerMessageId = 0;

function getWorker() {
  if (workerInstance) {
    return workerInstance;
  }
  const workerUrl = new URL("../workers/paintHeightmapWorker.js", import.meta.url);
  workerInstance = new Worker(workerUrl, { name: "paint-heightmap-worker" });
  workerInstance.onmessage = handleWorkerMessage;
  workerInstance.onerror = (event) => {
    console.error("Paint worker error", event?.message || event);
  };
  workerInstance.onmessageerror = (event) => {
    console.error("Paint worker message error", event);
  };
  return workerInstance;
}

function handleWorkerMessage(event) {
  const data = event.data || {};
  if (data.type === "debug") {
    const level = data.level || "log";
    const msg = data.message;
    if (console[level]) {
      console[level](`[paint-worker] ${msg}`);
    } else {
      console.log(`[paint-worker] ${msg}`);
    }
    return;
  }
  const pending = workerResponses.get(data.id);
  if (!pending) return;
  workerResponses.delete(data.id);
  if (data.ok) {
    const pixels = data.buffer ? new Float32Array(data.buffer) : new Float32Array();
    pending.resolve({ width: data.width, height: data.height, pixels });
  } else {
    const error = new Error(data.error || "Unbekannter Worker Fehler");
    if (data.stack) {
      error.stack = data.stack;
    }
    pending.reject(error);
  }
}

function runModel(payload) {
  const worker = getWorker();
  const id = ++workerMessageId;
  const promise = new Promise((resolve, reject) => {
    workerResponses.set(id, { resolve, reject });
  });
  worker.postMessage({ id, type: "infer", payload });
  return promise;
}

export function queuePaintInference(nodeId, payload, hooks = {}) {
  if (!payload || !payload.rgbPixels || !payload.width || !payload.height) {
    return;
  }
  const token = Date.now();
  pendingJobs.set(nodeId, token);
  hooks.onStatus?.("running");
  runModel(payload)
    .then((result) => {
      if (pendingJobs.get(nodeId) !== token) {
        return;
      }
      pendingJobs.delete(nodeId);
      hooks.onStatus?.("success");
      updateHeightmapSettings(nodeId, { generatedHeightmap: result });
      hooks.onComplete?.(result);
    })
    .catch((error) => {
      if (pendingJobs.get(nodeId) !== token) {
        return;
      }
      pendingJobs.delete(nodeId);
      hooks.onStatus?.("error", error);
      console.error("LinesToTerrain Inferenz fehlgeschlagen", error);
    });
}
