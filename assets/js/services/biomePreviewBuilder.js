import { buildPreviewTree } from "./previewBuilder.js";
import { ensureBiomeRegions, getBiomeRegions, getBiomeGlobals, getContinentSettings } from "../state/projectState.js";

export function buildBiomesPreviewJob() {
  const continents = getContinentSettings();
  const regionCount = continents.continentCount || 0;
  const regions = ensureBiomeRegions(regionCount);
  const globals = getBiomeGlobals();
  const regionJobs = regions.map((region) => {
    let heightmapJob = null;
    if (region.heightmapId) {
      const job = buildPreviewTree(region.heightmapId);
      if (job.ok) {
        heightmapJob = job.job;
      }
    }
    return {
      name: region.name || "",
      heightmapId: region.heightmapId || null,
      heightmapJob,
    };
  });
  return {
    ok: true,
    job: {
      type: "biomes",
      continents,
      regions: regionJobs,
      blendHeightRange: coercePositive(globals.blendHeightRange, 40),
    },
  };
}

function clamp01(value, fallback) {
  const num = parseFloat(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(1, num));
}

function coerce(value, fallback) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : fallback;
}

function coercePositive(value, fallback) {
  const num = parseFloat(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, num);
}
