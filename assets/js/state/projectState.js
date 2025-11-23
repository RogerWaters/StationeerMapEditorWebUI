import { WORLD_HEIGHT_LIMIT } from "../config/constants.js";

const HEIGHTMAP_META = {
  generic: {
    labelPrefix: {
      twoD: "2D Heightmap",
      threeD: "3D Heightmap",
    },
    icon: "wxi-pencil",
  },
  noise: {
    labelPrefix: "Noise Heightmap",
    icon: "item fa-solid fa-wave-square",
  },
  upload: {
    labelPrefix: "Upload Heightmap",
    icon: "wxi-download",
  },
  paint: {
    labelPrefix: "Paint Heightmap",
    icon: "wxi-pencil",
  },
  combine: {
    labelPrefix: "Combine Heightmap",
    icon: "wxi-columns",
  },
};

export const NOISE_HEIGHTMAP_DEFAULTS = {
  noiseType: "opensimplex2",
  seed: 1337,
  frequency: 0.02,
  offsetX: 0,
  offsetY: 0,
  fractalType: "fbm",
  octaves: 5,
  lacunarity: 2,
  gain: 0.5,
  weightedStrength: 0.0,
  pingPongStrength: 2.0,
  cellularDistanceFunction: "euclidean",
  cellularReturnType: "distance2",
  cellularJitter: 1.0,
  domainWarpType: "opensimplex2",
  domainWarpAmplitude: 1.0,
  domainWarpFrequency: 0.5,
};

export const COMBINE_HEIGHTMAP_DEFAULTS = {
  method: "add",
  normalizeResult: false,
  childA: {
    normalize: false,
    offset: 0,
    factor: 1,
  },
  childB: {
    normalize: false,
    offset: 0,
    factor: 1,
  },
};

export const UPLOAD_HEIGHTMAP_DEFAULTS = {
  displayName: "",
  mapping: "contain",
  minValue: 0,
  maxValue: 1,
  normalize: false,
  invert: false,
  sourceImage: null,
};

export const PAINT_HEIGHTMAP_DEFAULTS = {
  displayName: "",
  brushSize: 2,
  tool: "peak",
  paintMode: "brush",
  paintMaterial: "peak",
  shapeType: "rectangle",
  normalizeResult: true,
  blurAmount: 1,
  canvasData: null,
  generatedHeightmap: null,
};

export const BIOME_REGION_DEFAULTS = {
  heightmapId: null,
};

export const BIOME_GLOBAL_DEFAULTS = {
  blendHeightRange: 40, // pixels
};

export const CONTINENT_DEFAULTS = {
  method: "voronoi",
  continentCount: 5,
  seed: 1337,
  voronoiJitter: 0.35,
  voronoiRelaxIterations: 1,
  inflationIrregularity: 0.35,
  inflationDrift: 0.25,
};

export const projectState = {
  loaded: false,
  name: "Kein Projekt",
  spec: {
    size: 4096,
    height: 512,
  },
  biomes: {
    globals: { ...BIOME_GLOBAL_DEFAULTS },
    regions: [],
  },
  continents: { ...CONTINENT_DEFAULTS },
  heightmaps: {
    twoD: [],
    threeD: [],
  },
  counters: {
    twoD: 1,
    threeD: 1,
  },
};

export function sanitizeWorldName(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/[^A-Za-z0-9._\- ]+/g, "_");
}

export function getDefaultWorldFormValues() {
  const base = projectState.loaded ? projectState.name : "World 01";
  const safe = sanitizeWorldName(base) || "World 01";
  return {
    worldName: safe,
    worldSize: projectState.spec.size,
    worldHeight: projectState.spec.height,
  };
}

export function clampWorldHeight(heightValue) {
  const numeric = parseInt(heightValue, 10);
  if (Number.isNaN(numeric)) return WORLD_HEIGHT_LIMIT.min;
  return Math.max(WORLD_HEIGHT_LIMIT.min, Math.min(WORLD_HEIGHT_LIMIT.max, numeric));
}

export function resetHeightmaps() {
  projectState.heightmaps.twoD = [];
  projectState.heightmaps.threeD = [];
  projectState.counters.twoD = 1;
  projectState.counters.threeD = 1;
}

export function resetBiomes() {
  projectState.biomes = { globals: { ...BIOME_GLOBAL_DEFAULTS }, regions: [] };
}

export function resetContinents() {
  projectState.continents = { ...CONTINENT_DEFAULTS };
}

export function createWorld(config) {
  projectState.loaded = true;
  projectState.name = sanitizeWorldName(config.worldName) || "Unbenannte Welt";
  projectState.spec = {
    size: parseInt(config.worldSize, 10) || 4096,
    height: clampWorldHeight(config.worldHeight ?? WORLD_HEIGHT_LIMIT.min),
  };
  resetHeightmaps();
  resetBiomes();
  resetContinents();
  return { ...projectState };
}

export function updateWorldSettings(values) {
  const sanitized = sanitizeWorldName(values.worldName);
  if (sanitized) {
    projectState.name = sanitized;
  }
  if (values.worldSize) {
    projectState.spec.size = parseInt(values.worldSize, 10) || projectState.spec.size;
  }
  if (values.worldHeight) {
    projectState.spec.height = clampWorldHeight(values.worldHeight);
  }
  return { ...projectState };
}

function heightmapLabel(bucket) {
  return bucket === "twoD" ? "2D Heightmap" : "3D Heightmap";
}

export function createHeightmap(bucket, options = {}) {
  if (!projectState.loaded) {
    throw new Error("Projekt nicht geladen");
  }
  const key = bucket === "threeD" ? "threeD" : "twoD";
  const counter = projectState.counters[key]++;
  const nodeId = `${key}-hm-${counter}`;
  const mapType = options.mapType || "generic";
  const meta = HEIGHTMAP_META[mapType] || HEIGHTMAP_META.generic;
  const explicitName = typeof options.name === "string" ? options.name.trim() : "";
  const prefix =
    typeof meta.labelPrefix === "string"
      ? meta.labelPrefix
      : meta.labelPrefix?.[key] || HEIGHTMAP_META.generic.labelPrefix[key];
  const label = explicitName || `${prefix} ${counter}`;
  const node = {
    id: nodeId,
    value: label,
    mapType,
    icon: options.icon || meta.icon,
    settings: buildInitialSettings(mapType),
    parentId: options.parentId || null,
    children: [],
  };
  projectState.heightmaps[key].push(node);
  if (node.parentId) {
    const parentEntry = getHeightmapById(node.parentId);
    if (parentEntry && parentEntry.node.children) {
      parentEntry.node.children.push(node.id);
    }
  }
  return node;
}

function buildInitialSettings(mapType) {
  if (mapType === "noise") {
    return { ...NOISE_HEIGHTMAP_DEFAULTS };
  }
  if (mapType === "combine") {
    return { ...COMBINE_HEIGHTMAP_DEFAULTS };
  }
  if (mapType === "upload") {
    return { ...UPLOAD_HEIGHTMAP_DEFAULTS };
  }
  if (mapType === "paint") {
    return { ...PAINT_HEIGHTMAP_DEFAULTS };
  }
  return {};
}

export function buildHeightmapBranch(type, parentId = null) {
  const nodes = [];
  if (!parentId) {
    nodes.push({
      id: `${type}-add`,
      value: type === "twoD" ? "+ Neue 2D Heightmap" : "+ Neue 3D Heightmap",
      icon: "wxi-plus",
      action: true,
      $css: "tree-action-node",
    });
  }
  const pool = projectState.heightmaps[type].filter((hm) => hm.parentId === parentId);
  pool.forEach((hm) => {
    const item = {
      id: hm.id,
      value: hm.value,
      icon: hm.icon,
    };
    if (hm.mapType === "combine") {
      const children = buildHeightmapBranch(type, hm.id);
      if ((hm.children || []).length < 2) {
        children.unshift({
          id: `child-add::${hm.id}`,
          value: "+ Neue Heightmap",
          icon: "wxi-plus",
          action: true,
          $css: "tree-action-node",
        });
      }
      item.data = children;
    }
    nodes.push(item);
  });
  return nodes;
}

export function buildNavigationTree() {
  const worldLabel = projectState.name ? `World (${projectState.name})` : "World";
  const continentsLabel =
    projectState.continents?.continentCount && Number.isFinite(projectState.continents.continentCount)
      ? `Kontinente (${projectState.continents.continentCount})`
      : "Kontinente";
  return [
    {
      id: "world",
      value: worldLabel,
      open: true,
      data: [
        { id: "continents", value: continentsLabel },
        { id: "biomes", value: "Biomes" },
        { id: "heightmap", value: "Heightmap Layer" },
      ],
    },
    {
      id: "twoD-root",
      value: "2D Heightmaps",
      open: true,
      icon: "wxi-folder",
      data: buildHeightmapBranch("twoD"),
    },
    {
      id: "threeD-root",
      value: "3D Heightmaps",
      open: true,
      icon: "wxi-folder",
      data: buildHeightmapBranch("threeD"),
    },
  ];
}

export function getHeightmapById(nodeId) {
  for (const bucket of ["twoD", "threeD"]) {
    const node = projectState.heightmaps[bucket].find((hm) => hm.id === nodeId);
    if (node) {
      return { bucket, node };
    }
  }
  return null;
}

export function updateHeightmapSettings(nodeId, updates) {
  const target = getHeightmapById(nodeId);
  if (!target) return null;
  target.node.settings = {
    ...target.node.settings,
    ...updates,
  };
  if (updates.displayName !== undefined) {
    const trimmed = (updates.displayName || "").trim();
    target.node.value = trimmed || target.node.value;
  }
  return target.node.settings;
}

if (typeof window !== "undefined") {
  window.projectState = projectState;
}

function clamp01(value, fallback = 0) {
  const num = parseFloat(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function clampInt(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function sanitizeContinentSettings(raw) {
  const base = { ...CONTINENT_DEFAULTS, ...(raw || {}) };
  return {
    method: base.method === "inflation" ? "inflation" : "voronoi",
    continentCount: clampInt(base.continentCount, 1, 64, CONTINENT_DEFAULTS.continentCount),
    seed: clampInt(base.seed, 0, Number.MAX_SAFE_INTEGER, CONTINENT_DEFAULTS.seed),
    voronoiJitter: clamp01(base.voronoiJitter, CONTINENT_DEFAULTS.voronoiJitter),
    voronoiRelaxIterations: clampInt(base.voronoiRelaxIterations, 0, 5, CONTINENT_DEFAULTS.voronoiRelaxIterations),
    inflationIrregularity: clamp01(base.inflationIrregularity, CONTINENT_DEFAULTS.inflationIrregularity),
    inflationDrift: clamp01(base.inflationDrift, CONTINENT_DEFAULTS.inflationDrift),
  };
}

export function updateContinentSettings(updates) {
  const next = sanitizeContinentSettings({
    ...projectState.continents,
    ...(updates || {}),
  });
  projectState.continents = next;
  return next;
}

export function getContinentSettings() {
  return sanitizeContinentSettings(projectState.continents);
}

function buildBiomeRegions(count) {
  const regions = [];
  for (let i = 0; i < count; i += 1) {
    const existing = projectState.biomes.regions[i];
    regions.push({
      name: existing?.name || `Region ${i + 1}`,
      heightmapId: existing?.heightmapId ?? null,
    });
  }
  return regions;
}

export function ensureBiomeRegions(regionCount) {
  const count = Math.max(0, parseInt(regionCount, 10) || 0);
  projectState.biomes.regions = buildBiomeRegions(count);
  return projectState.biomes.regions;
}

export function updateBiomeRegion(index, updates) {
  if (!projectState.biomes.regions || index < 0 || index >= projectState.biomes.regions.length) return null;
  const current = projectState.biomes.regions[index];
  const next = {
    ...current,
    ...updates,
  };
  projectState.biomes.regions[index] = next;
  return next;
}

export function getBiomeRegions() {
  return projectState.biomes.regions || [];
}

export function updateBiomeGlobals(updates) {
  projectState.biomes.globals = {
    ...projectState.biomes.globals,
    ...updates,
  };
  return projectState.biomes.globals;
}

export function getBiomeGlobals() {
  return projectState.biomes.globals || { ...BIOME_GLOBAL_DEFAULTS };
}
