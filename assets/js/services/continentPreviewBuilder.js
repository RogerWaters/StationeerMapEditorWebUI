import { CONTINENT_DEFAULTS, sanitizeContinentSettings } from "../state/projectState.js";

export function buildContinentsPreviewJob(rawSettings) {
  const settings = sanitizeContinentSettings({ ...CONTINENT_DEFAULTS, ...(rawSettings || {}) });
  return {
    ok: true,
    job: {
      type: "continents",
      settings,
    },
  };
}

export function getContinentPreviewSize(worldSize) {
  const parsed = parseInt(worldSize, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 512;
  }
  return parsed;
}
