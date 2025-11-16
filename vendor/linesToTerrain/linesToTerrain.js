(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LinesToTerrain = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const INPUT_SIZE = 512;
  const MAX_UINT16 = 0xffff;
  const IN_BLACK = 5140;
  const IN_WHITE = 60395;

  function ensureORT(ortOverride) {
    const ort = ortOverride || (typeof globalThis !== 'undefined' ? globalThis.ort : undefined);
    if (!ort) {
      throw new Error('onnxruntime is not available. Include onnxruntime-web or provide an ort instance.');
    }
    return ort;
  }

  function isImageDataLike(value) {
    return value && typeof value.width === 'number' && typeof value.height === 'number' && value.data;
  }

  function hasDomCanvas(value) {
    return typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement;
  }

  function hasDomImage(value) {
    return (typeof HTMLImageElement !== 'undefined' && value instanceof HTMLImageElement) ||
      (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap);
  }

  function canvasFromSize(width, height) {
    if (typeof document !== 'undefined' && document.createElement) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    if (typeof OffscreenCanvas !== 'undefined') {
      return new OffscreenCanvas(width, height);
    }
    throw new Error('Unable to create a canvas in this environment.');
  }

  function getPixelsFromSource(source) {
    if (isImageDataLike(source)) {
      return source;
    }
    if (hasDomCanvas(source)) {
      const ctx = source.getContext('2d');
      return ctx.getImageData(0, 0, source.width, source.height);
    }
    if (hasDomImage(source)) {
      const canvas = canvasFromSize(INPUT_SIZE, INPUT_SIZE);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(source, 0, 0, INPUT_SIZE, INPUT_SIZE);
      return ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    }
    if (source && source.data && typeof source.width === 'number' && typeof source.height === 'number') {
      return source;
    }
    throw new Error('Unsupported image source. Provide ImageData, Canvas, ImageBitmap, or an object with width/height/data.');
  }

  function toTypedArray(data) {
    if (ArrayBuffer.isView(data)) {
      return data;
    }
    if (Array.isArray(data)) {
      return Uint8Array.from(data);
    }
    if (data instanceof ArrayBuffer) {
      return new Uint8Array(data);
    }
    throw new Error('Unsupported pixel data container.');
  }

  function prepareInputPixels(source) {
    const pixels = getPixelsFromSource(source);
    let { width, height } = pixels;
    let data = toTypedArray(pixels.data);

    if (width !== INPUT_SIZE || height !== INPUT_SIZE) {
      if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') {
        throw new Error('Input must be 512x512 when canvas APIs are unavailable.');
      }
      const canvas = canvasFromSize(INPUT_SIZE, INPUT_SIZE);
      const ctx = canvas.getContext('2d');
      const imageData = new ImageData(new Uint8ClampedArray(data.buffer.slice(0, width * height * 4)), width, height);
      ctx.putImageData(imageData, 0, 0);
      const resized = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
      width = INPUT_SIZE;
      height = INPUT_SIZE;
      data = resized.data;
    }

    const channels = Math.round(data.length / (width * height));
    if (channels !== 3 && channels !== 4) {
      throw new Error('Expected image data with 3 or 4 channels.');
    }

    const rgb = new Float32Array(width * height * 3);
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += channels) {
      rgb[i] = data[j];
      rgb[i + 1] = data[j + 1];
      rgb[i + 2] = data[j + 2];
    }
    return { width, height, data: rgb };
  }

  function rgbToGray16(rgb) {
    const pixels = rgb.length / 3;
    const gray = new Float32Array(pixels);
    const scale = MAX_UINT16 / 255;
    for (let i = 0, j = 0; i < pixels; i++, j += 3) {
      const g = 0.2989 * rgb[j] + 0.587 * rgb[j + 1] + 0.114 * rgb[j + 2];
      gray[i] = g * scale;
    }
    return gray;
  }

  function applyLevels(buffer) {
    const out = new Float32Array(buffer.length);
    const invRange = 1 / (IN_WHITE - IN_BLACK);
    for (let i = 0; i < buffer.length; i++) {
      let value = (buffer[i] - IN_BLACK) * invRange;
      value = Math.max(0, Math.min(1, value));
      out[i] = value * MAX_UINT16;
    }
    return out;
  }

  function boxBlur3x3(buffer, width, height) {
    const out = new Float32Array(buffer.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let acc = 0;
        for (let ky = -1; ky <= 1; ky++) {
          const ny = Math.min(height - 1, Math.max(0, y + ky));
          for (let kx = -1; kx <= 1; kx++) {
            const nx = Math.min(width - 1, Math.max(0, x + kx));
            acc += buffer[ny * width + nx];
          }
        }
        out[y * width + x] = acc / 9;
      }
    }
    return out;
  }

  function toUint16(buffer) {
    const out = new Uint16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const value = Math.max(0, Math.min(MAX_UINT16, Math.round(buffer[i])));
      out[i] = value;
    }
    return out;
  }

  function toImageDataFromUint16(data, width, height) {
    if (typeof ImageData === 'undefined') {
      return null;
    }
    const clamped = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = 0; i < data.length; i++, j += 4) {
      const value8 = data[i] / 257;
      clamped[j] = clamped[j + 1] = clamped[j + 2] = value8;
      clamped[j + 3] = 255;
    }
    return new ImageData(clamped, width, height);
  }

  async function fetchJson(url) {
    const response = await fetch(url);
    if (!response || !response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response ? response.status : "unknown"}`);
    }
    return response.json();
  }

  async function fetchBinary(url) {
    const response = await fetch(url);
    if (!response || !response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response ? response.status : "unknown"}`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async function loadChunkedModel(manifestUrl) {
    if (typeof fetch === 'undefined') {
      throw new Error('Chunked model loading requires fetch support.');
    }
    const manifest = await fetchJson(manifestUrl);
    if (!manifest || !Array.isArray(manifest.chunks)) {
      throw new Error('Invalid LinesToTerrain manifest.');
    }
    const base = new URL(manifest.basePath || '.', manifestUrl);
    const buffers = [];
    let total = typeof manifest.length === 'number' ? manifest.length : 0;
    for (const chunk of manifest.chunks) {
      const file = chunk && chunk.file ? String(chunk.file) : null;
      if (!file) {
        continue;
      }
      const chunkUrl = new URL(file, base);
      const data = await fetchBinary(chunkUrl);
      buffers.push(data);
      if (!total) {
        total = 0;
      }
      total += data.length;
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const buf of buffers) {
      merged.set(buf, offset);
      offset += buf.length;
    }
    return merged;
  }

  class LinesToTerrainModel {
    constructor(options = {}) {
      this.modelUrl = options.modelUrl || 'model/mountain.manifest.json';
      this.ort = ensureORT(options.ort);
      this.sessionOptions = options.sessionOptions || {};
      this.session = null;
    }

    async load(modelUrl) {
      if (modelUrl) {
        this.modelUrl = modelUrl;
      }
      if (!this.session) {
        let source = this.modelUrl;
        if (typeof source === 'string' && source.endsWith('.json')) {
          source = await loadChunkedModel(source);
        }
        this.session = await this.ort.InferenceSession.create(source, this.sessionOptions);
      }
      return this;
    }

    async predict(source) {
      await this.load();
      const prepared = prepareInputPixels(source);
      const inputTensor = new this.ort.Tensor('float32', prepared.data, [prepared.height, prepared.width, 3]);
      const feeds = { 'browser_input:0': inputTensor };
      const results = await this.session.run(feeds);
      const rgbTensor = results['browser_output:0'];
      const rgbData = rgbTensor.data instanceof Uint8Array ? rgbTensor.data : Uint8Array.from(rgbTensor.data);
      const gray16 = rgbToGray16(rgbData);
      const leveled = applyLevels(gray16);
      const blurred = boxBlur3x3(leveled, INPUT_SIZE, INPUT_SIZE);
      const uint16 = toUint16(blurred);

      return {
        width: INPUT_SIZE,
        height: INPUT_SIZE,
        data: uint16,
        toImageData() {
          return toImageDataFromUint16(uint16, INPUT_SIZE, INPUT_SIZE);
        }
      };
    }
  }

  return { LinesToTerrainModel };
}));
