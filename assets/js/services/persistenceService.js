import { buildPreviewTree } from "./previewBuilder.js";
import {
  clampWorldHeight,
  getContinentSettings,
  projectState,
  resetContinents,
  resetHeightmaps,
  sanitizeContinentSettings,
  sanitizeWorldName,
} from "../state/projectState.js";

let floatWorker = null;
const floatJobs = new Map();

function ensureFloatWorker() {
  if (floatWorker) return floatWorker;
  const workerUrl = new URL("../workers/noiseHeightmapWorker.js", import.meta.url);
  floatWorker = new Worker(workerUrl, { type: "module", name: "heightmap-float-worker" });
  floatWorker.onmessage = (event) => {
    const { jobId, error, floatBuffer } = event.data || {};
    if (!jobId || !floatJobs.has(jobId)) return;
    const pending = floatJobs.get(jobId);
    floatJobs.delete(jobId);
    if (error) {
      pending.reject(new Error(error));
      return;
    }
    if (floatBuffer) {
      pending.resolve(new Float32Array(floatBuffer));
    } else {
      pending.reject(new Error("Kein Float-Resultat vom Worker."));
    }
  };
  floatWorker.onerror = (event) => {
    console.error("Float-Worker Fehler", event?.message || event);
  };
  return floatWorker;
}

function ensureJSZip() {
  if (typeof window === "undefined" || !window.JSZip) {
    throw new Error("JSZip nicht geladen.");
  }
  return window.JSZip;
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function float32ToLeBytes(array) {
  const buffer = new ArrayBuffer(array.length * 4);
  const view = new DataView(buffer);
  for (let i = 0; i < array.length; i += 1) {
    view.setFloat32(i * 4, array[i], true);
  }
  return new Uint8Array(buffer);
}

function bytesToFloat32(buffer) {
  const view = new DataView(buffer);
  const count = buffer.byteLength / 4;
  const out = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    out[i] = view.getFloat32(i * 4, true);
  }
  return out;
}

function buildProjectXml(projectMeta, nodes) {
  const lines = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(
    `<Project name="${escapeAttr(projectMeta.name)}" size="${projectMeta.spec.size}" height="${projectMeta.spec.height}">`
  );
  lines.push(`  <Counters twoD="${projectMeta.counters.twoD}" threeD="${projectMeta.counters.threeD}" />`);
  const continentSettings = projectMeta.continents || {};
  lines.push(`  <Continents><![CDATA[${JSON.stringify(continentSettings)}]]></Continents>`);
  nodes.forEach((node) => {
    lines.push(
      `  <Heightmap id="${escapeAttr(node.id)}" bucket="${escapeAttr(node.bucket)}" type="${escapeAttr(node.type)}" label="${escapeAttr(node.label)}" parent="${escapeAttr(node.parentId || "")}">`
    );
    lines.push(`    <Children>`);
    (node.children || []).forEach((childId) => {
      lines.push(`      <Child id="${escapeAttr(childId)}" />`);
    });
    lines.push(`    </Children>`);
    lines.push(`    <Settings><![CDATA[${JSON.stringify(node.settings || {})}]]></Settings>`);
    lines.push(`    <Assets>`);
    if (node.assets.preview) {
      lines.push(
        `      <Preview path="${escapeAttr(node.assets.preview.path)}" width="${node.assets.preview.width}" height="${node.assets.preview.height}" format="RFloat32" />`
      );
    }
    if (node.assets.source) {
      lines.push(
        `      <Source path="${escapeAttr(node.assets.source.path)}" width="${node.assets.source.width}" height="${node.assets.source.height}" name="${escapeAttr(node.assets.source.name)}" format="RFloat32" />`
      );
    }
    if (node.assets.canvas) {
      lines.push(
        `      <Canvas path="${escapeAttr(node.assets.canvas.path)}" width="${node.assets.canvas.width}" height="${node.assets.canvas.height}" format="RFloat32" />`
      );
    }
    if (node.assets.generated) {
      lines.push(
        `      <Generated path="${escapeAttr(node.assets.generated.path)}" width="${node.assets.generated.width}" height="${node.assets.generated.height}" format="RFloat32" />`
      );
    }
    lines.push(`    </Assets>`);
    lines.push(`  </Heightmap>`);
  });
  lines.push(`</Project>`);
  return lines.join("\n");
}

function renderHeightmapFloats(tree, width, height) {
  return new Promise((resolve, reject) => {
    const jobId = `float-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    floatJobs.set(jobId, { resolve, reject });
    const worker = ensureFloatWorker();
    worker.postMessage({ jobId, nodeId: "export", width, height, tree, mode: "float" });
    setTimeout(() => {
      if (!floatJobs.has(jobId)) return;
      floatJobs.delete(jobId);
      reject(new Error("Timeout beim Rendern der Heightmap."));
    }, 120000);
  });
}

function coerceInt(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function coerceFloat(value, fallback = 0) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function addAsset(zip, path, floats) {
  if (!floats || !floats.length) return null;
  const bytes = float32ToLeBytes(floats);
  zip.file(path, bytes);
  return path;
}

function pickBucket(raw) {
  return raw === "threeD" ? "threeD" : "twoD";
}

export async function saveTerrainProject(onProgress) {
  if (!projectState.loaded) {
    throw new Error("Kein Projekt geladen.");
  }
  const JSZip = ensureJSZip();
  const zip = new JSZip();
  const worldSize = projectState.spec.size || 256;
  const nodesMeta = [];
  const buckets = ["twoD", "threeD"];
  for (const bucket of buckets) {
    const list = projectState.heightmaps[bucket] || [];
    for (const node of list) {
      onProgress?.(`Berechne ${node.value} ...`);
      const previewJob = buildPreviewTree(node.id);
      if (!previewJob.ok) {
        throw new Error(`Kann Vorschau für ${node.value} nicht erstellen: ${previewJob.error}`);
      }
      const previewFloats = await renderHeightmapFloats(previewJob.job, worldSize, worldSize);
      const previewPath = `heightmaps/${bucket}/${node.id}.r32`;
      await addAsset(zip, previewPath, previewFloats);
      const assets = {
        preview: { path: previewPath, width: worldSize, height: worldSize },
      };
      const settings = node.settings || {};
      if (node.mapType === "upload" && settings.sourceImage?.pixels?.length) {
        const srcPath = `sources/${node.id}.r32`;
        await addAsset(zip, srcPath, settings.sourceImage.pixels);
        assets.source = {
          path: srcPath,
          width: settings.sourceImage.width,
          height: settings.sourceImage.height,
          name: settings.sourceImage.name || node.value || "Upload",
        };
      }
      if (node.mapType === "paint") {
        if (settings.canvasData?.pixels?.length) {
          const canvasPath = `paint/canvas-${node.id}.r32`;
          await addAsset(zip, canvasPath, settings.canvasData.pixels);
          assets.canvas = {
            path: canvasPath,
            width: settings.canvasData.width,
            height: settings.canvasData.height,
          };
        }
        if (settings.generatedHeightmap?.pixels?.length) {
          const genPath = `paint/generated-${node.id}.r32`;
          await addAsset(zip, genPath, settings.generatedHeightmap.pixels);
          assets.generated = {
            path: genPath,
            width: settings.generatedHeightmap.width,
            height: settings.generatedHeightmap.height,
          };
        }
      }
      nodesMeta.push({
        id: node.id,
        bucket,
        type: node.mapType,
        label: node.value,
        parentId: node.parentId || "",
        children: Array.isArray(node.children) ? [...node.children] : [],
        settings,
        assets,
      });
    }
  }
  const projectMeta = {
    name: projectState.name || "Unbenannte Welt",
    spec: {
      size: worldSize,
      height: projectState.spec.height || 512,
    },
    counters: {
      twoD: projectState.counters.twoD || 1,
      threeD: projectState.counters.threeD || 1,
    },
    continents: getContinentSettings(),
  };
  const xml = buildProjectXml(projectMeta, nodesMeta);
  zip.file("project.xml", xml);
  onProgress?.("Erzeuge .terrain Archiv ...");
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const filename = `${sanitizeWorldName(projectMeta.name) || "world"}.terrain`;
  return { blob, filename };
}

export async function loadTerrainFromFile(file) {
  const JSZip = ensureJSZip();
  const zip = await JSZip.loadAsync(file);
  const xmlEntry = zip.file("project.xml");
  if (!xmlEntry) {
    throw new Error("project.xml fehlt im Terrain-Archiv.");
  }
  const xmlText = await xmlEntry.async("string");
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, "application/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new Error("XML konnte nicht geparst werden.");
  }
  const projectEl = doc.querySelector("Project");
  if (!projectEl) {
    throw new Error("Project Wurzelknoten fehlt.");
  }
  const name = projectEl.getAttribute("name") || "Geladene Welt";
  const size = coerceInt(projectEl.getAttribute("size"), 256);
  const height = clampWorldHeight(coerceInt(projectEl.getAttribute("height"), projectState.spec.height || 0));
  const countersEl = projectEl.querySelector("Counters");
  const counters = {
    twoD: coerceInt(countersEl?.getAttribute("twoD"), 1),
    threeD: coerceInt(countersEl?.getAttribute("threeD"), 1),
  };
  const continentsNode = projectEl.querySelector("Continents");
  let continents = getContinentSettings();
  if (continentsNode && continentsNode.textContent) {
    try {
      continents = sanitizeContinentSettings(JSON.parse(continentsNode.textContent));
    } catch (error) {
      console.warn("Konnte Kontinent-Daten nicht parsen, nutze Defaults.", error);
      continents = getContinentSettings();
    }
  }
  const nextState = {
    loaded: true,
    name: sanitizeWorldName(name) || "Geladene Welt",
    spec: { size, height },
    heightmaps: { twoD: [], threeD: [] },
    counters,
    continents,
  };
  const heightmapNodes = projectEl.querySelectorAll("Heightmap");
  for (const el of heightmapNodes) {
    const id = el.getAttribute("id");
    const bucket = pickBucket(el.getAttribute("bucket"));
    const type = el.getAttribute("type") || "generic";
    const label = el.getAttribute("label") || id || type;
    const parentId = el.getAttribute("parent") || null;
    const settingsNode = el.querySelector("Settings");
    let settings = {};
    if (settingsNode && settingsNode.textContent) {
      try {
        settings = JSON.parse(settingsNode.textContent);
      } catch (error) {
        console.warn("Konnte Settings nicht parsen für", id, error);
      }
    }
    const children = [];
    el.querySelectorAll("Children > Child").forEach((childEl) => {
      const childId = childEl.getAttribute("id");
      if (childId) children.push(childId);
    });
    const assets = {};
    const previewEl = el.querySelector("Assets > Preview");
    if (previewEl) {
      assets.preview = {
        path: previewEl.getAttribute("path"),
        width: coerceInt(previewEl.getAttribute("width")),
        height: coerceInt(previewEl.getAttribute("height")),
      };
    }
    const sourceEl = el.querySelector("Assets > Source");
    if (sourceEl) {
      assets.source = {
        path: sourceEl.getAttribute("path"),
        width: coerceInt(sourceEl.getAttribute("width")),
        height: coerceInt(sourceEl.getAttribute("height")),
        name: sourceEl.getAttribute("name") || "Upload",
      };
    }
    const canvasEl = el.querySelector("Assets > Canvas");
    if (canvasEl) {
      assets.canvas = {
        path: canvasEl.getAttribute("path"),
        width: coerceInt(canvasEl.getAttribute("width")),
        height: coerceInt(canvasEl.getAttribute("height")),
      };
    }
    const generatedEl = el.querySelector("Assets > Generated");
    if (generatedEl) {
      assets.generated = {
        path: generatedEl.getAttribute("path"),
        width: coerceInt(generatedEl.getAttribute("width")),
        height: coerceInt(generatedEl.getAttribute("height")),
      };
    }
    nextState.heightmaps[bucket].push({
      id,
      value: label,
      mapType: type,
      settings,
      parentId,
      children,
      assets,
    });
  }
  nextState.counters.twoD = Math.max(nextState.counters.twoD, (nextState.heightmaps.twoD?.length || 0) + 1);
  nextState.counters.threeD = Math.max(nextState.counters.threeD, (nextState.heightmaps.threeD?.length || 0) + 1);
  await hydrateAssets(zip, nextState.heightmaps);
  applyLoadedState(nextState);
  return { ok: true, project: { name: nextState.name, size: nextState.spec.size, height: nextState.spec.height } };
}

async function hydrateAssets(zip, heightmaps) {
  const buckets = ["twoD", "threeD"];
  for (const bucket of buckets) {
    for (const node of heightmaps[bucket]) {
      if (node.mapType === "upload" && node.assets?.source?.path) {
        const entry = zip.file(node.assets.source.path);
        if (entry) {
          const buffer = await entry.async("arraybuffer");
          const pixels = bytesToFloat32(buffer);
          node.settings.sourceImage = {
            name: node.assets.source.name || "Upload",
            width: node.assets.source.width,
            height: node.assets.source.height,
            pixels,
          };
        } else {
          console.warn("Source Datei fehlt im Archiv:", node.assets.source.path);
        }
      }
      if (node.mapType === "paint") {
        if (node.assets?.canvas?.path) {
          const entry = zip.file(node.assets.canvas.path);
          if (entry) {
            const buffer = await entry.async("arraybuffer");
            const pixels = bytesToFloat32(buffer);
            node.settings.canvasData = {
              width: node.assets.canvas.width,
              height: node.assets.canvas.height,
              pixels,
            };
          } else {
            console.warn("Canvas Datei fehlt im Archiv:", node.assets.canvas.path);
          }
        }
        if (node.assets?.generated?.path) {
          const entry = zip.file(node.assets.generated.path);
          if (entry) {
            const buffer = await entry.async("arraybuffer");
            const pixels = bytesToFloat32(buffer);
            node.settings.generatedHeightmap = {
              width: node.assets.generated.width,
              height: node.assets.generated.height,
              pixels,
            };
          } else {
            console.warn("Generated Datei fehlt im Archiv:", node.assets.generated.path);
          }
        }
      }
    }
  }
}

function applyLoadedState(nextState) {
  resetHeightmaps();
  resetContinents();
  projectState.loaded = true;
  projectState.name = nextState.name;
  projectState.spec = { ...nextState.spec };
  projectState.counters = { ...nextState.counters };
  projectState.continents = sanitizeContinentSettings(nextState.continents || {});
  projectState.heightmaps.twoD = nextState.heightmaps.twoD || [];
  projectState.heightmaps.threeD = nextState.heightmaps.threeD || [];
}
