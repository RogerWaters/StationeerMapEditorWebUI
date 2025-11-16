const uploads = new Map();

export function setUploadData(nodeId, { width, height, data }) {
  if (!nodeId || !width || !height || !data) return;
  uploads.set(nodeId, {
    width,
    height,
    data: data instanceof Float32Array ? data.slice() : new Float32Array(data),
  });
}

export function getUploadData(nodeId) {
  const entry = uploads.get(nodeId);
  if (!entry) return null;
  return {
    width: entry.width,
    height: entry.height,
    data: entry.data.slice().buffer,
  };
}
