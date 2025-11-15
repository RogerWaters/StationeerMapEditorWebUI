import FastNoiseLite from "/vendor/FastNoiseLite.js";

const noise = new FastNoiseLite();

const noiseTypeMap = {
  opensimplex2: FastNoiseLite.NoiseType.OpenSimplex2,
  opensimplex2s: FastNoiseLite.NoiseType.OpenSimplex2S,
  cellular: FastNoiseLite.NoiseType.Cellular,
  perlin: FastNoiseLite.NoiseType.Perlin,
  value: FastNoiseLite.NoiseType.Value,
  valuecubic: FastNoiseLite.NoiseType.ValueCubic,
};

const fractalTypeMap = {
  none: FastNoiseLite.FractalType.None,
  fbm: FastNoiseLite.FractalType.FBm,
  ridged: FastNoiseLite.FractalType.Ridged,
  pingpong: FastNoiseLite.FractalType.PingPong,
  domainwarpprogressive: FastNoiseLite.FractalType.DomainWarpProgressive,
  domainwarpindependent: FastNoiseLite.FractalType.DomainWarpIndependent,
};

const distanceFunctionMap = {
  euclidean: FastNoiseLite.CellularDistanceFunction.Euclidean,
  euclideansq: FastNoiseLite.CellularDistanceFunction.EuclideanSq,
  manhattan: FastNoiseLite.CellularDistanceFunction.Manhattan,
  hybrid: FastNoiseLite.CellularDistanceFunction.Hybrid,
};

const returnTypeMap = {
  cellvalue: FastNoiseLite.CellularReturnType.CellValue,
  distance: FastNoiseLite.CellularReturnType.Distance,
  distance2: FastNoiseLite.CellularReturnType.Distance2,
  distance2add: FastNoiseLite.CellularReturnType.Distance2Add,
  distance2sub: FastNoiseLite.CellularReturnType.Distance2Sub,
  distance2mul: FastNoiseLite.CellularReturnType.Distance2Mul,
  distance2div: FastNoiseLite.CellularReturnType.Distance2Div,
};

const domainWarpTypeMap = {
  opensimplex2: FastNoiseLite.DomainWarpType.OpenSimplex2,
  opensimplex2reduced: FastNoiseLite.DomainWarpType.OpenSimplex2Reduced,
  basicgrid: FastNoiseLite.DomainWarpType.BasicGrid,
};

self.onmessage = (event) => {
  const { jobId, nodeId, width, height, settings } = event.data || {};
  if (!jobId || !nodeId || !width || !height) {
    return;
  }
  try {
    configureNoise(settings || {});
    const buffer = renderBuffer(width, height, settings || {});
    self.postMessage({ jobId, nodeId, width, height, buffer }, [buffer.buffer]);
  } catch (error) {
    self.postMessage({ jobId, nodeId, error: error?.message || String(error) });
  }
};

function configureNoise(settings) {
  noise.SetSeed(parseInt(settings.seed, 10) || 0);
  noise.SetFrequency(parseFloat(settings.frequency) || 0.02);
  const noiseType = noiseTypeMap[(settings.noiseType || "").toLowerCase()] || FastNoiseLite.NoiseType.OpenSimplex2;
  noise.SetNoiseType(noiseType);

  const fractalType = fractalTypeMap[(settings.fractalType || "").toLowerCase()] || FastNoiseLite.FractalType.FBm;
  noise.SetFractalType(fractalType);
  noise.SetFractalOctaves(parseInt(settings.octaves, 10) || 1);
  noise.SetFractalLacunarity(parseFloat(settings.lacunarity) || 2);
  noise.SetFractalGain(parseFloat(settings.gain) || 0.5);
  noise.SetFractalWeightedStrength(parseFloat(settings.weightedStrength) || 0);
  noise.SetFractalPingPongStrength(parseFloat(settings.pingPongStrength) || 2);

  const distanceFn = distanceFunctionMap[(settings.cellularDistanceFunction || "").toLowerCase()];
  if (distanceFn) {
    noise.SetCellularDistanceFunction(distanceFn);
  }
  const returnType = returnTypeMap[(settings.cellularReturnType || "").toLowerCase()];
  if (returnType) {
    noise.SetCellularReturnType(returnType);
  }
  if (settings.cellularJitter !== undefined) {
    noise.SetCellularJitter(parseFloat(settings.cellularJitter) || 1);
  }

  const domainWarpType = domainWarpTypeMap[(settings.domainWarpType || "").toLowerCase()];
  if (domainWarpType) {
    noise.SetDomainWarpType(domainWarpType);
  }
  if (settings.domainWarpAmplitude !== undefined) {
    noise.SetDomainWarpAmp(parseFloat(settings.domainWarpAmplitude) || 1);
  }
}

function renderBuffer(width, height, settings) {
  const buffer = new Uint8ClampedArray(width * height * 4);
  const offsetX = parseFloat(settings.offsetX) || 0;
  const offsetY = parseFloat(settings.offsetY) || 0;
  let ptr = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sampleX = x + offsetX;
      const sampleY = y + offsetY;
      const value = noise.GetNoise(sampleX, sampleY);
      const normalized = Math.max(0, Math.min(1, (value + 1) * 0.5));
      const color = Math.round(normalized * 255);
      buffer[ptr++] = color;
      buffer[ptr++] = color;
      buffer[ptr++] = color;
      buffer[ptr++] = 255;
    }
  }
  return buffer;
}
