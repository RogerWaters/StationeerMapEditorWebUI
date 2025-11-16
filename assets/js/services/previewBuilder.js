import {
  getHeightmapById,
  NOISE_HEIGHTMAP_DEFAULTS,
  COMBINE_HEIGHTMAP_DEFAULTS,
  UPLOAD_HEIGHTMAP_DEFAULTS,
  PAINT_HEIGHTMAP_DEFAULTS,
} from "../state/projectState.js";

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
    case "upload":
      return buildUploadJob(node);
    case "paint":
      return buildPaintJob(node);
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

function buildUploadJob(node) {
  const settings = { ...UPLOAD_HEIGHTMAP_DEFAULTS, ...(node.settings || {}) };
  const source = settings.sourceImage;
  if (!source || !source.pixels || !source.width || !source.height) {
    return { ok: false, error: "Bitte zuerst ein Bild hochladen." };
  }
  return {
    ok: true,
    job: {
      type: "upload",
      settings: {
        mapping: settings.mapping || "contain",
        minValue: coerce(settings.minValue, 0),
        maxValue: coerce(settings.maxValue, 1),
        normalize: !!settings.normalize,
        invert: !!settings.invert,
      },
      source: {
        name: source.name || "Upload",
        width: source.width,
        height: source.height,
        pixels: source.pixels,
      },
    },
  };
}

function coerce(value, fallback) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

function buildPaintJob(node) {
  const settings = { ...PAINT_HEIGHTMAP_DEFAULTS, ...(node.settings || {}) };
  const data = settings.canvasData;
  if (!data || !data.width || !data.height) {
    return { ok: false, error: "Bitte zeichne zuerst etwas auf der Leinwand." };
  }
  const generated = settings.generatedHeightmap;
  if (!generated || !generated.pixels) {
    return { ok: false, error: "LinesToTerrain Ergebnis wird berechnet ..." };
  }
  return {
    ok: true,
    job: {
      type: "upload",
      settings: {
        mapping: "contain",
        minValue: 0,
        maxValue: 1,
        normalize: false,
        invert: false,
      },
      source: {
        width: generated.width || data.width,
        height: generated.height || data.height,
        pixels: generated.pixels,
      },
    },
  };
}
