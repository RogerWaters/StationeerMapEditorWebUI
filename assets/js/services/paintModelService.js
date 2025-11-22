import { updateHeightmapSettings } from "../state/projectState.js";

const pendingJobs = new Map();
const workerResponses = new Map();
const jobQueue = [];
const workerPool = [];
let workerMessageId = 0;
const MAX_WORKERS = 5;

function createWorkerSlot() {
  const workerUrl = new URL("../workers/paintHeightmapWorker.js", import.meta.url);
  const worker = new Worker(workerUrl, { name: "paint-heightmap-worker" });
  const slot = { worker, busy: false, currentJobId: null };
  worker.onmessage = (event) => handleWorkerMessage(event, slot);
  worker.onerror = (event) => handleWorkerError(event, slot);
  worker.onmessageerror = (event) => handleWorkerError(event, slot);
  return slot;
}

function ensureWorkerPool() {
  if (workerPool.length) return;
  for (let i = 0; i < MAX_WORKERS; i += 1) {
    workerPool.push(createWorkerSlot());
  }
}

function handleWorkerMessage(event, slot) {
  const data = event.data || {};
  if (data.type === "debug") {
    const level = data.level || "log";
    const msg = data.message;
    if (console[level]) {
      console[level](`[paint-worker] ${msg}`, data.timings || "");
    } else {
      console.log(`[paint-worker] ${msg}`, data.timings || "");
    }
    return;
  }
  const pending = workerResponses.get(data.id);
  if (slot) {
    slot.busy = false;
    slot.currentJobId = null;
  }
  if (!pending) {
    dispatchJobs();
    return;
  }
  workerResponses.delete(data.id);
  if (pending.queueWait != null) {
    const info = `[paint-worker] queue wait ${pending.queueWait}ms`;
    console.info(info, pending.meta || "");
  }
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
  dispatchJobs();
}

function handleWorkerError(event, slot) {
  if (!slot) return;
  console.error("Paint worker error", event?.message || event);
  const jobId = slot.currentJobId;
  if (jobId && workerResponses.has(jobId)) {
    const pending = workerResponses.get(jobId);
    workerResponses.delete(jobId);
    pending.reject(new Error(event?.message || "Paint worker Fehler"));
  }
  slot.busy = false;
  slot.currentJobId = null;
  dispatchJobs();
}

function dispatchJobs() {
  if (!workerPool.length) return;
  for (const slot of workerPool) {
    if (slot.busy) continue;
    const job = jobQueue.shift();
    if (!job) break;
    slot.busy = true;
    slot.currentJobId = job.id;
    const dispatchTime = Date.now();
    job.queueWait = dispatchTime - job.createdAt;
    workerResponses.set(job.id, { resolve: job.resolve, reject: job.reject, meta: job.meta, queueWait: job.queueWait });
    slot.worker.postMessage({ id: job.id, type: "infer", payload: job.payload });
  }
}

function runModel(payload, meta = {}) {
  ensureWorkerPool();
  return new Promise((resolve, reject) => {
    const id = ++workerMessageId;
    jobQueue.push({ id, payload, resolve, reject, meta, createdAt: Date.now() });
    dispatchJobs();
  });
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

export function runPaintModel(payload, meta = {}) {
  if (!payload || !payload.rgbPixels || !payload.width || !payload.height) {
    return Promise.reject(new Error("Ungültige Sketchdaten für LinesToTerrain."));
  }
  return runModel(payload, meta);
}
