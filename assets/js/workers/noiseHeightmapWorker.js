import FastNoiseLite from "/vendor/FastNoiseLite.js";

const noise = new FastNoiseLite();

self.onmessage = (event) => {
  const { jobId, nodeId, width, height, tree, mode } = event.data || {};
  if (!jobId || !nodeId || !width || !height || !tree) {
    return;
  }
  try {
    const result = renderJob(tree, width, height);
    if (mode === "float") {
      if (!result || result.kind !== "float") {
        throw new Error("Float Mode unterstützt nur Heightmap-Jobs.");
      }
      self.postMessage({ jobId, nodeId, width, height, floatBuffer: result.data.buffer }, [result.data.buffer]);
      return;
    }
    if (result.kind === "rgba") {
      self.postMessage({ jobId, nodeId, width, height, buffer: result.data }, [result.data.buffer]);
      return;
    }
    const buffer = floatsToBuffer(result.data, width, height);
    self.postMessage({ jobId, nodeId, width, height, buffer }, [buffer.buffer]);
  } catch (error) {
    self.postMessage({ jobId, nodeId, error: error?.message || String(error) });
  }
};

function renderJob(tree, width, height) {
  switch (tree.type) {
    case "noise":
      return wrapFloat(renderNoise(tree.settings || {}, width, height));
    case "combine":
      return wrapFloat(renderCombine(tree, width, height));
    case "upload":
      return wrapFloat(renderUpload(tree, width, height));
    case "continents":
      return renderContinents(tree.settings || {}, width, height);
    default:
      throw new Error(`Unbekannter Job-Typ: ${tree.type}`);
  }
}

function wrapFloat(array) {
  return { kind: "float", data: array };
}

function renderFloatJob(tree, width, height) {
  const result = renderJob(tree, width, height);
  if (!result || result.kind !== "float") {
    throw new Error("Erwarte Heightmap-Daten.");
  }
  return result.data;
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
  const childA = renderFloatJob(tree.childA, width, height);
  const childB = renderFloatJob(tree.childB, width, height);
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

function renderContinents(settings, width, height) {
  const count = clampInt(settings.continentCount, 1, 64, 5);
  const method = settings.method === "inflation" ? "inflation" : "voronoi";
  const seed = clampInt(settings.seed, 0, Number.MAX_SAFE_INTEGER, 1);
  const rng = mulberry32(seed || 1);
  const seeds = placeSeeds(count, width, height, rng);
  const palette = buildPalette(count, seed);
  const assignment =
    method === "inflation"
      ? inflateContinents(seeds, width, height, settings, rng)
      : buildVoronoi(seeds, width, height, settings);
  const buffer = new Uint8ClampedArray(width * height * 4);
  let ptr = 0;
  for (let i = 0; i < assignment.length; i += 1) {
    const regionIndex = assignment[i] >= 0 ? assignment[i] % palette.length : 0;
    const color = palette[regionIndex];
    buffer[ptr++] = color.r;
    buffer[ptr++] = color.g;
    buffer[ptr++] = color.b;
    buffer[ptr++] = 255;
  }
  return { kind: "rgba", data: buffer };
}

function placeSeeds(count, width, height, rng) {
  const seeds = [];
  const used = new Set();
  const maxAttempts = count * 50;
  let attempts = 0;
  while (seeds.length < count && attempts < maxAttempts) {
    const x = Math.floor(rng() * width);
    const y = Math.floor(rng() * height);
    const key = y * width + x;
    attempts += 1;
    if (used.has(key)) continue;
    used.add(key);
    seeds.push({ x, y });
  }
  // Fallback, falls zu viele Duplikate gezogen wurden
  for (let y = 0; seeds.length < count && y < height; y += Math.max(1, Math.floor(height / count))) {
    for (let x = 0; seeds.length < count && x < width; x += Math.max(1, Math.floor(width / count))) {
      const key = y * width + x;
      if (!used.has(key)) {
        used.add(key);
        seeds.push({ x, y });
      }
    }
  }
  return seeds;
}

function buildVoronoi(seeds, width, height, settings) {
  const jitter = clamp01(settings.voronoiJitter ?? 0);
  const relaxIterations = clampInt(settings.voronoiRelaxIterations, 0, 5, 0);
  let sites = seeds.map((s) => ({ ...s }));
  let assignment = assignVoronoi(sites, width, height, jitter, settings.seed || 0);
  for (let i = 0; i < relaxIterations; i += 1) {
    sites = lloydRelax(assignment, sites, width, height);
    assignment = assignVoronoi(sites, width, height, jitter, settings.seed || 0);
  }
  return assignment;
}

function assignVoronoi(sites, width, height, jitter, seed) {
  const result = new Int16Array(width * height);
  let ptr = 0;
  const jitterScale = 3 * jitter;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const jx = jitter ? (hash2D(x, y, seed) - 0.5) * 2 * jitterScale : 0;
      const jy = jitter ? (hash2D(y, x, seed ^ 0x9e3779b9) - 0.5) * 2 * jitterScale : 0;
      let best = -1;
      let bestDist = Infinity;
      for (let i = 0; i < sites.length; i += 1) {
        const dx = x + jx - sites[i].x;
        const dy = y + jy - sites[i].y;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      result[ptr++] = best;
    }
  }
  return result;
}

function lloydRelax(assignments, currentSites, width, height) {
  const accum = currentSites.map((site) => ({ x: 0, y: 0, count: 0, fallback: site }));
  let idx = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const region = assignments[idx++];
      if (region >= 0 && accum[region]) {
        accum[region].x += x;
        accum[region].y += y;
        accum[region].count += 1;
      }
    }
  }
  return accum.map((entry, regionIndex) => {
    if (entry.count === 0) return { ...currentSites[regionIndex] };
    return { x: entry.x / entry.count, y: entry.y / entry.count };
  });
}

let wasmFindEmptyModule = null;
let wasmFindEmptyInstance = null;
let wasmFindEmptyMemory = null;
let wasmFindEmptyFn = null;

function ensureFindEmptyWasm(capacity) {
  try {
    if (!wasmFindEmptyModule) {
      const bytes = loadWasmBytes("/assets/wasm/inflation-find-empty.wasm");
      if (!bytes) return null;
      wasmFindEmptyModule = new WebAssembly.Module(bytes);
    }
    if (!wasmFindEmptyInstance) {
      wasmFindEmptyInstance = new WebAssembly.Instance(wasmFindEmptyModule, {});
      wasmFindEmptyMemory = wasmFindEmptyInstance.exports.memory;
      wasmFindEmptyFn = wasmFindEmptyInstance.exports.find_empty;
    }
    const requiredPages = Math.ceil((capacity * 2) / 65536);
    const currentPages = wasmFindEmptyMemory.buffer.byteLength / 65536;
    if (requiredPages > currentPages) {
      wasmFindEmptyMemory.grow(requiredPages - currentPages);
    }
    return { memory: wasmFindEmptyMemory, findEmpty: wasmFindEmptyFn };
  } catch (error) {
    console.warn("WASM find_empty nicht verfügbar:", error);
    return null;
  }
}

function loadWasmBytes(url) {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, false);
    xhr.responseType = "arraybuffer";
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 300) {
      return new Uint8Array(xhr.response);
    }
  } catch (error) {
    console.warn("WASM Fetch fehlgeschlagen", error);
  }
  return null;
}

function inflateContinents(seeds, width, height, settings, rng) {
  const irregularity = clamp01(settings.inflationIrregularity ?? 0.35);
  const drift = clamp01(settings.inflationDrift ?? 0.25);
  const capacity = width * height;
  const wasm = ensureFindEmptyWasm(capacity);
  const grid = wasm ? new Int16Array(wasm.memory.buffer, 0, capacity) : new Int16Array(capacity);
  grid.fill(-1);
  const queue = {
    x: new Int32Array(capacity),
    y: new Int32Array(capacity),
    owner: new Int16Array(capacity),
    dirX: new Int8Array(capacity),
    dirY: new Int8Array(capacity),
    queuedMask: new Uint8Array(capacity),
    head: 0,
    tail: 0,
    size: 0,
    capacity,
  };
  let remaining = capacity;
  const fallbackState = { cursor: 0 };
  seeds.forEach((seed, owner) => {
    const key = seed.y * width + seed.x;
    if (grid[key] !== -1) return;
    grid[key] = owner;
    remaining -= 1;
    addNeighborsToQueue(queue, seed.x, seed.y, owner, grid, width, height, rng, irregularity, drift, 0, 0);
  });
  let iterations = 0;
  while (remaining > 0) {
    if (queue.size === 0) {
      const seeded = seedFallbackCell(grid, width, height, seeds.length, rng, queue, irregularity, drift, fallbackState, wasm);
      if (seeded) {
        remaining -= 1;
        continue;
      }
      break;
    }
    const idx = queue.head;
    const x = queue.x[idx];
    const y = queue.y[idx];
    const owner = queue.owner[idx];
    const dirX = queue.dirX[idx];
    const dirY = queue.dirY[idx];
    const key = y * width + x;
    queue.queuedMask[key] = 0;
    queue.head = (queue.head + 1) % queue.capacity;
    queue.size -= 1;
    if (grid[key] !== -1) continue;
    grid[key] = owner;
    remaining -= 1;
    iterations += 1;
    addNeighborsToQueue(queue, x, y, owner, grid, width, height, rng, irregularity, drift, dirX, dirY);
  }
  return grid;
}

function addNeighborsToQueue(
  queue,
  x,
  y,
  owner,
  grid,
  width,
  height,
  rng,
  irregularity,
  drift,
  dirX,
  dirY,
  forceAll = false
) {
  const dirs = orderedNeighbors(dirX, dirY, drift, rng);
  const baseChance = 0.65;
  const wiggleScale = 0.6 + irregularity * 0.4;
  const irregularPenalty = irregularity * 0.2;
  for (let i = 0; i < dirs.length; i += 1) {
    const dir = dirs[i];
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const key = ny * width + nx;
    if (grid[key] !== -1 || queue.queuedMask[key]) continue;
    const wiggle = forceAll ? 0 : fastHashWiggle(key) * wiggleScale;
    const addChance = forceAll ? 1 : clamp01(baseChance + wiggle - irregularPenalty);
    if (rng() <= addChance && queue.size < queue.capacity) {
      const idx = queue.tail;
      queue.x[idx] = nx;
      queue.y[idx] = ny;
      queue.owner[idx] = owner;
      queue.dirX[idx] = dir.dx;
      queue.dirY[idx] = dir.dy;
      queue.queuedMask[key] = 1;
      queue.tail = (queue.tail + 1) % queue.capacity;
      queue.size += 1;
    }
  }
}

const NEIGHBORS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: -1 },
];

function orderedNeighbors(dirX, dirY, drift, rng) {
  const bias = clamp01(drift);
  // Small fixed shuffle to avoid huge per-cell cost; rotate start index using drift direction
  let start = 0;
  if (bias > 0.01 && (dirX !== 0 || dirY !== 0)) {
    let bestScore = -Infinity;
    for (let i = 0; i < NEIGHBORS.length; i += 1) {
      const n = NEIGHBORS[i];
      const score = n.dx * dirX + n.dy * dirY;
      if (score > bestScore) {
        bestScore = score;
        start = i;
      }
    }
  } else {
    start = Math.floor(rng() * NEIGHBORS.length);
  }
  const order = [];
  for (let i = 0; i < NEIGHBORS.length; i += 1) {
    const idx = (start + i) % NEIGHBORS.length;
    order.push(NEIGHBORS[idx]);
  }
  // light shuffle by swapping one random pair to inject irregularity
  const swapA = Math.floor(rng() * order.length);
  const swapB = Math.floor(rng() * order.length);
  const tmp = order[swapA];
  order[swapA] = order[swapB];
  order[swapB] = tmp;
  return order;
}

function fastHashWiggle(key) {
  // Cheap hash mapped to [-0.5, 0.5]
  let h = key + 0x7feb352d;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  return (h & 1023) / 1023 - 0.5;
}

function seedFallbackCell(
  grid,
  width,
  height,
  regionCount,
  rng,
  queue,
  irregularity,
  drift,
  state,
  wasm
) {
  let pick = -1;
  const capacity = grid.length;
  // Try wasm-accelerated scan
  if (wasm && wasm.findEmpty) {
    pick = wasm.findEmpty(0, capacity, state.cursor | 0);
    if (pick === -1 && state.cursor > 0) {
      pick = wasm.findEmpty(0, capacity, 0);
    }
  }
  // few random attempts as fallback
  if (pick === -1) {
    for (let attempts = 0; attempts < 120 && pick === -1; attempts += 1) {
      const candidate = Math.floor(rng() * capacity);
      if (grid[candidate] === -1) {
        pick = candidate;
        break;
      }
    }
  }
  // deterministic sweep if still nothing
  if (pick === -1 && state) {
    for (let i = 0; i < capacity; i += 1) {
      const idx = (state.cursor + i) % capacity;
      if (grid[idx] === -1) {
        pick = idx;
        break;
      }
    }
  }
  if (pick === -1) return false;
  const x = pick % width;
  const y = Math.floor(pick / width);
  const owner = Math.floor(rng() * Math.max(regionCount, 1));
  grid[pick] = owner;
  if (state) {
    state.cursor = (pick + 1) % capacity;
  }
  addNeighborsToQueue(queue, x, y, owner, grid, width, height, rng, irregularity, drift, 0, 0, true);
  return true;
}

function buildPalette(count, seed) {
  const palette = [];
  for (let i = 0; i < count; i += 1) {
    const hueBase = (i / Math.max(1, count)) * 320;
    const jitter = hash2D(i, seed || 1, seed + 1337) * 40 - 20;
    const hue = (hueBase + jitter + 360) % 360;
    const sat = 55 + (hash2D(seed, i + 42, seed + 99) * 25);
    const light = 52 + (hash2D(seed + 77, i + 7, seed) * 18);
    const rgb = hslToRgb(hue, sat / 100, light / 100);
    palette.push({ r: rgb.r, g: rgb.g, b: rgb.b });
  }
  return palette;
}

function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let [r1, g1, b1] = [0, 0, 0];
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp >= 1 && hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp >= 2 && hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp >= 3 && hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp >= 4 && hp < 5) [r1, g1, b1] = [x, 0, c];
  else if (hp >= 5 && hp < 6) [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

function mulberry32(seed) {
  let t = seed + 0x6d2b79f5;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2D(x, y, seed) {
  let h = Math.imul(x + 0x7feb352d, y + 0x846ca68b) ^ seed;
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  return (h >>> 0) / 4294967295;
}

function clamp01(value) {
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}
