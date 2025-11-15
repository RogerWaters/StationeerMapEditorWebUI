import FastNoiseLite from "/vendor/FastNoiseLite.js";

const noise = new FastNoiseLite();

self.onmessage = (event) => {
  const { jobId, nodeId, width, height, tree } = event.data || {};
  if (!jobId || !nodeId || !width || !height || !tree) {
    return;
  }
  try {
    const data = renderJob(tree, width, height);
    const buffer = floatsToBuffer(data, width, height);
    self.postMessage({ jobId, nodeId, width, height, buffer }, [buffer.buffer]);
  } catch (error) {
    self.postMessage({ jobId, nodeId, error: error?.message || String(error) });
  }
};

function renderJob(tree, width, height) {
  switch (tree.type) {
    case "noise":
      return renderNoise(tree.settings || {}, width, height);
    case "combine":
      return renderCombine(tree, width, height);
    case "upload":
      return renderUpload(tree, width, height);
    default:
      throw new Error(`Unbekannter Job-Typ: ${tree.type}`);
  }
}

function renderNoise(settings, width, height) {
  configureNoise(settings);
  const result = new Float32Array(width * height);
  const offsetX = parseFloat(settings.offsetX) || 0;
  const offsetY = parseFloat(settings.offsetY) || 0;
  let ptr = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = noise.GetNoise(x + offsetX, y + offsetY);
      const normalized = (value + 1) * 0.5;
      result[ptr++] = normalized;
    }
  }
  return result;
}

function renderCombine(tree, width, height) {
  const settings = tree.settings || {};
  const childA = renderJob(tree.childA, width, height);
  const childB = renderJob(tree.childB, width, height);
  applyChildModifiers(childA, settings.childA || {});
  applyChildModifiers(childB, settings.childB || {});
  const output = new Float32Array(childA.length);
  for (let i = 0; i < output.length; i += 1) {
    output[i] = applyMethod(settings.method, childA[i], childB[i]);
  }
  if (settings.normalizeResult) {
    normalizeArray(output);
  }
  return output;
}

function renderUpload(tree, width, height) {
  if (!tree.source || !tree.source.pixels) {
    throw new Error("Kein Bild vorhanden.");
  }
  const mapping = (tree.settings?.mapping || "contain").toLowerCase();
  const scaled = resampleSource(tree.source, width, height, mapping);
  applyUploadAdjustments(scaled, tree.settings || {});
  return scaled;
}

function configureNoise(settings) {
  noise.SetSeed(parseInt(settings.seed, 10) || 0);
  noise.SetFrequency(parseFloat(settings.frequency) || 0.02);
  const noiseType = (settings.noiseType || "opensimplex2").toLowerCase();
  switch (noiseType) {
    case "opensimplex2":
      noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
      break;
    case "opensimplex2s":
      noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
      break;
    case "cellular":
      noise.SetNoiseType(FastNoiseLite.NoiseType.Cellular);
      break;
    case "perlin":
      noise.SetNoiseType(FastNoiseLite.NoiseType.Perlin);
      break;
    case "value":
      noise.SetNoiseType(FastNoiseLite.NoiseType.Value);
      break;
    case "valuecubic":
      noise.SetNoiseType(FastNoiseLite.NoiseType.ValueCubic);
      break;
    default:
      noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2);
      break;
  }
  const fractalType = (settings.fractalType || "none").toLowerCase();
  switch (fractalType) {
    case "fbm":
      noise.SetFractalType(FastNoiseLite.FractalType.FBm);
      break;
    case "ridged":
      noise.SetFractalType(FastNoiseLite.FractalType.Ridged);
      break;
    case "pingpong":
      noise.SetFractalType(FastNoiseLite.FractalType.PingPong);
      break;
    default:
      noise.SetFractalType(FastNoiseLite.FractalType.None);
      break;
  }
  noise.SetFractalOctaves(parseInt(settings.octaves, 10) || 1);
  noise.SetFractalLacunarity(parseFloat(settings.lacunarity) || 2);
  noise.SetFractalGain(parseFloat(settings.gain) || 0.5);
  noise.SetFractalWeightedStrength(parseFloat(settings.weightedStrength) || 0);
  noise.SetFractalPingPongStrength(parseFloat(settings.pingPongStrength) || 2);
}

function applyChildModifiers(array, modifiers) {
  if (modifiers.normalize) {
    normalizeArray(array);
  }
  const offset = parseFloat(modifiers.offset) || 0;
  const factor = parseFloat(modifiers.factor);
  for (let i = 0; i < array.length; i += 1) {
    array[i] = (array[i] + offset) * (Number.isFinite(factor) ? factor : 1);
  }
}

function normalizeArray(array) {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < array.length; i += 1) {
    const value = array[i];
    if (value < min) min = value;
    if (value > max) max = value;
  }
  const range = max - min || 1;
  for (let i = 0; i < array.length; i += 1) {
    array[i] = (array[i] - min) / range;
  }
}

function applyMethod(method = "add", a, b) {
  switch ((method || "add").toLowerCase()) {
    case "add":
      return a + b;
    case "subtract":
      return a - b;
    case "multiply":
      return a * b;
    case "divide":
      return b !== 0 ? a / b : 0;
    case "average":
      return (a + b) * 0.5;
    case "max":
      return Math.max(a, b);
    case "min":
      return Math.min(a, b);
    case "pow":
      return Math.pow(a, b);
    case "log":
      return b > 0 && a > 0 ? Math.log(b) / Math.log(a) : 0;
    default:
      return a + b;
  }
}

function floatsToBuffer(data, width, height) {
  const buffer = new Uint8ClampedArray(width * height * 4);
  let ptr = 0;
  for (let i = 0; i < data.length; i += 1) {
    const clamped = Math.max(0, Math.min(1, data[i]));
    const color = Math.round(clamped * 255);
    buffer[ptr++] = color;
    buffer[ptr++] = color;
    buffer[ptr++] = color;
    buffer[ptr++] = 255;
  }
  return buffer;
}

function resampleSource(source, width, height, mapping) {
  const srcWidth = parseInt(source.width, 10) || 1;
  const srcHeight = parseInt(source.height, 10) || 1;
  const srcPixels = source.pixels || [];
  const target = new Float32Array(width * height);
  const scaleX = width / srcWidth;
  const scaleY = height / srcHeight;
  const scale =
    mapping === "cover"
      ? Math.max(scaleX || 1, scaleY || 1)
      : Math.min(scaleX || 1, scaleY || 1);
  const scaledWidth = srcWidth * scale;
  const scaledHeight = srcHeight * scale;
  const offsetX = (width - scaledWidth) * 0.5;
  const offsetY = (height - scaledHeight) * 0.5;
  let ptr = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const srcX = (x - offsetX) / scale;
      const srcY = (y - offsetY) / scale;
      let value = 0;
      if (mapping === "cover") {
        value = sampleNearest(srcPixels, srcWidth, srcHeight, clamp(srcX, 0, srcWidth - 1), clamp(srcY, 0, srcHeight - 1));
      } else {
        if (srcX >= 0 && srcX < srcWidth && srcY >= 0 && srcY < srcHeight) {
          value = sampleNearest(srcPixels, srcWidth, srcHeight, srcX, srcY);
        } else {
          value = 0;
        }
      }
      target[ptr++] = value;
    }
  }
  return target;
}

function sampleNearest(pixels, width, height, x, y) {
  const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
  return pixels[iy * width + ix] || 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function applyUploadAdjustments(array, settings) {
  if (settings.normalize) {
    normalizeArray(array);
  } else {
    const min = parseFloat(settings.minValue);
    const max = parseFloat(settings.maxValue);
    const minValue = Number.isFinite(min) ? min : 0;
    const maxValue = Number.isFinite(max) ? max : 1;
    const span = maxValue - minValue;
    const range = span === 0 ? 1 : span;
    for (let i = 0; i < array.length; i += 1) {
      const normalized = (array[i] - minValue) / range;
      array[i] = Math.max(0, Math.min(1, normalized));
    }
  }
  if (settings.invert) {
    for (let i = 0; i < array.length; i += 1) {
      array[i] = 1 - array[i];
    }
  }
}
