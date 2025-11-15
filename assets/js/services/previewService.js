const controllers = {};
let previewWorker = null;

export function schedulePreview({ nodeId, width, height, statusId, imageId, buildJob }) {
  if (!nodeId) return;
  const controller = ensureController(nodeId, statusId, imageId);
  if (controller.timer) {
    clearTimeout(controller.timer);
  }
  setStatus(statusId, "Berechne...");
  controller.timer = setTimeout(() => dispatchPreview(nodeId, width, height, buildJob), 250);
}

function dispatchPreview(nodeId, width, height, buildJob) {
  const controller = controllers[nodeId];
  if (!controller) return;
  controller.timer = null;
  const jobResult = buildJob();
  if (!jobResult || !jobResult.ok) {
    setStatus(controller.statusId, jobResult?.error || "Keine Daten");
    return;
  }
  const jobId = `${nodeId}-${Date.now()}`;
  controller.currentJobId = jobId;
  getWorker().postMessage({ jobId, nodeId, width, height, tree: jobResult.job });
}

function ensureController(nodeId, statusId, imageId) {
  if (!controllers[nodeId]) {
    controllers[nodeId] = { imageUrl: null };
  }
  const controller = controllers[nodeId];
  controller.statusId = statusId;
  controller.imageId = imageId;
  return controller;
}

function getWorker() {
  if (!previewWorker) {
    previewWorker = new Worker("/assets/js/workers/noiseHeightmapWorker.js", { type: "module" });
    previewWorker.onmessage = handleWorkerMessage;
    previewWorker.onerror = (err) => console.error("Preview worker", err);
  }
  return previewWorker;
}

function handleWorkerMessage(event) {
  const { jobId, nodeId, width, height, buffer, error } = event.data || {};
  if (!nodeId || !jobId) return;
  const controller = controllers[nodeId];
  if (!controller || controller.currentJobId !== jobId) {
    return;
  }
  controller.currentJobId = null;
  if (error) {
    setStatus(controller.statusId, error);
    return;
  }
  if (buffer) {
    updateImage(controller, buffer, width, height);
  }
  setStatus(controller.statusId, "");
}

function updateImage(controller, buffer, width, height) {
  const imageEl = document.getElementById(controller.imageId);
  if (!imageEl) return;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const imageData = new ImageData(new Uint8ClampedArray(buffer), width, height);
  ctx.putImageData(imageData, 0, 0);
  canvas.toBlob((blob) => {
    if (!blob) return;
    if (controller.imageUrl) {
      URL.revokeObjectURL(controller.imageUrl);
    }
    controller.imageUrl = URL.createObjectURL(blob);
    imageEl.src = controller.imageUrl;
  });
}

function setStatus(statusId, text) {
  if (!statusId) return;
  const el = document.getElementById(statusId);
  if (el) {
    el.textContent = text;
    el.style.opacity = text ? "1" : "0";
  }
}
