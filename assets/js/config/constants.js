export const WORLD_HEIGHT_LIMIT = { min: 1, max: 1024 };

export const WORLD_SIZE_OPTIONS = Array.from({ length: 7 }, (_, index) => {
  const exponent = index + 8;
  const size = Math.pow(2, exponent);
  return {
    id: size,
    value: `${size} x ${size} (2^${exponent})`,
  };
});

export const PANEL_TEMPLATES = {
  default:
    "<div class='section-title'>Willkommen</div><div class='notes'>Wählen Sie links ein Element, um dessen Arbeitsfläche zu öffnen.</div>",
  world:
    "<div class='section-title'>World Overview</div><div class='notes'>Globale Einstellungen der aktiven Welt werden hier konfiguriert.</div>",
  continents:
    "<div class='section-title'>Kontinente</div><div class='notes'>Verwalte kontinentale Platten, Splits und Offsets.</div>",
  biomes:
    "<div class='section-title'>Biomes</div><div class='notes'>Definiere Temperaturzonen, Feuchtigkeitscluster und Vegetationsdichten.</div>",
  heightmap:
    "<div class='section-title'>Heightmap Layer</div><div class='notes'>Zentrale Sammelstelle aller Heightmap-Layer inklusive Masken.</div>",
};
