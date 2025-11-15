import { getHeightmapById, NOISE_HEIGHTMAP_DEFAULTS, COMBINE_HEIGHTMAP_DEFAULTS } from "../state/projectState.js";

export function buildPreviewTree(nodeId) {
  const entry = getHeightmapById(nodeId);
  if (!entry) {
    return { ok: false, error: "Heightmap nicht gefunden." };
  }
  const node = entry.node;
  switch (node.mapType) {
    case "noise":
      return {
        ok: true,
        job: {
          type: "noise",
          settings: { ...NOISE_HEIGHTMAP_DEFAULTS, ...(node.settings || {}) },
        },
      };
    case "combine":
      return buildCombineJob(node);
    default:
      return { ok: false, error: `Preview für ${node.mapType} ist noch nicht implementiert.` };
  }
}

function buildCombineJob(node) {
  const settings = { ...COMBINE_HEIGHTMAP_DEFAULTS, ...(node.settings || {}) };
  const children = node.children || [];
  if (children.length < 2 || !children[0] || !children[1]) {
    return { ok: false, error: "Combine Heightmap benötigt zwei untergeordnete Heightmaps." };
  }
  const [childAId, childBId] = children;
  const childAJob = buildPreviewTree(childAId);
  if (!childAJob.ok) return childAJob;
  const childBJob = buildPreviewTree(childBId);
  if (!childBJob.ok) return childBJob;
  return {
    ok: true,
    job: {
      type: "combine",
      settings,
      childA: childAJob.job,
      childB: childBJob.job,
    },
  };
}
