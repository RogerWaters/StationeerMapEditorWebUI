import { WORLD_HEIGHT_LIMIT } from "../config/constants.js";

export const projectState = {
  loaded: false,
  name: "Kein Projekt",
  spec: {
    size: 4096,
    height: 512,
  },
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

export function createWorld(config) {
  projectState.loaded = true;
  projectState.name = sanitizeWorldName(config.worldName) || "Unbenannte Welt";
  projectState.spec = {
    size: parseInt(config.worldSize, 10) || 4096,
    height: clampWorldHeight(config.worldHeight ?? WORLD_HEIGHT_LIMIT.min),
  };
  resetHeightmaps();
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

export function createHeightmap(bucket) {
  if (!projectState.loaded) {
    throw new Error("Projekt nicht geladen");
  }
  const key = bucket === "threeD" ? "threeD" : "twoD";
  const counter = projectState.counters[key]++;
  const nodeId = `${key}-hm-${counter}`;
  const node = {
    id: nodeId,
    value: `${heightmapLabel(key)} ${counter}`,
  };
  projectState.heightmaps[key].push(node);
  return node;
}

export function buildHeightmapBranch(type) {
  const nodes = [
    {
      id: `${type}-add`,
      value: type === "twoD" ? "+ Neue 2D Heightmap" : "+ Neue 3D Heightmap",
    },
  ];
  const pool = projectState.heightmaps[type];
  nodes.push(...pool);
  return nodes;
}

export function buildNavigationTree() {
  const worldLabel = projectState.name ? `World (${projectState.name})` : "World";
  return [
    {
      id: "world",
      value: worldLabel,
      open: true,
      data: [
        { id: "continents", value: "Kontinente" },
        { id: "biomes", value: "Biomes" },
        { id: "heightmap", value: "Heightmap Layer" },
      ],
    },
    {
      id: "twoD-root",
      value: "2D Heightmaps",
      open: true,
      data: buildHeightmapBranch("twoD"),
    },
    {
      id: "threeD-root",
      value: "3D Heightmaps",
      open: true,
      data: buildHeightmapBranch("threeD"),
    },
  ];
}
