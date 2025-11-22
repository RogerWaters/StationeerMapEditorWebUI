import { defaultPanel } from "./panels/defaultPanel.js";
import { ensureTemplatePanel, getPanelTemplate } from "./panels/templates.js";
import { createWorldPanel, syncWorldPanelValues } from "./panels/worldPanel.js";
import { ensureContinentsPanel, syncContinentsPanel } from "./panels/continentsPanel.js";
import { ensureBiomesPanel, syncBiomesPanel } from "./panels/biomePanel.js";
import { ensureNoiseHeightmapPanel, syncNoiseHeightmapPanel } from "./panels/noiseHeightmapPanel.js";
import { ensureCombineHeightmapPanel, syncCombineHeightmapPanel } from "./panels/combineHeightmapPanel.js";
import { ensurePaintHeightmapPanel, syncPaintHeightmapPanel } from "./panels/paintHeightmapPanel.js";
import { ensureUploadHeightmapPanel, syncUploadHeightmapPanel } from "./panels/uploadHeightmapPanel.js";
import { registerHarness } from "./testing/harness.js";
import { openNewWorldDialog } from "./ui/newWorldDialog.js";
import { loadTerrainFromFile, saveTerrainProject } from "./services/persistenceService.js";
import {
  buildNavigationTree,
  createHeightmap,
  createWorld,
  getHeightmapById,
  projectState,
  updateWorldSettings,
} from "./state/projectState.js";

let saveButton;
let heightmapAddMenu;
let pendingAddBucket = null;
let pendingParentId = null;
let isSaving = false;
let isLoading = false;

export async function initApp(rootId = "app-root") {
  const container = document.getElementById(rootId) || document.body;
  const shell = createApplicationShell();
  webix.ui(shell, container);
  initInteractions();
  refreshNavigationTree();
  setSaveButtonState(false);
  await selectNode("world");
  registerHarness({
    onCreateWorld: handleCreateWorldFromPayload,
    onSelectNode: (nodeId) => selectNode(nodeId),
    getActivePanelId: () => getActivePanelId(),
    createHeightmapNode: ({ bucket, mapType, name, parentId }) => {
      const node = createHeightmap(bucket, { mapType, name, parentId });
      refreshNavigationTree(false);
      return node.id;
    },
  });
}

function createApplicationShell() {
  return {
    rows: [createToolbar(), createMainArea()],
  };
}

function createToolbar() {
  return {
    view: "toolbar",
    padding: { left: 12, right: 12 },
    css: "webix_dark",
    height: 52,
    elements: [
      { view: "label", label: "<span class='app-brand'>Map Generator</span>", width: 220 },
      {},
      {
        view: "layout",
        css: "toolbar-actions",
        width: 420,
        cols: [
          { view: "button", value: "New World", width: 130, css: "webix_primary", click: handleNewWorldClick },
          { view: "spacer", width: 12 },
          { view: "button", value: "Load World", width: 130, click: handleLoadWorld },
          { view: "spacer", width: 12 },
          {
            view: "button",
            id: "saveWorldBtn",
            value: "Save World",
            width: 130,
            css: "webix_secondary",
            click: handleSaveWorld,
            disabled: true,
          },
        ],
      },
      {},
    ],
  };
}

function createMainArea() {
  return {
    cols: [createSidebar(), { view: "resizer" }, createWorkspace()],
  };
}

function createSidebar() {
  return {
    type: "clean",
    padding: 12,
    width: 320,
    rows: [
      { template: "<div class='section-title'>Projektstruktur</div>", height: 30, borderless: true },
      {
        view: "tree",
        id: "navigation",
        select: true,
        borderless: true,
        data: buildNavigationTree(),
        on: {
          onBeforeSelect(id) {
            const item = this.getItem(id);
            if (item && item.disabled) {
              return false;
            }
            return true;
          },
          onItemClick: (id, e) => handleTreeItemClick(id, e, this),
          onAfterSelect: (id) => handleTreeSelection(id),
        },
      },
    ],
  };
}

function createWorkspace() {
  return {
    view: "multiview",
    id: "workspaceArea",
    css: "webix_dark workspace-panel",
    keepViews: true,
    animate: false,
    cells: [defaultPanel, createWorldPanel(handleWorldFieldChange)],
  };
}

function initInteractions() {
  saveButton = webix.$$("saveWorldBtn");
}

function refreshNavigationTree(preserveSelection = true) {
  const tree = webix.$$("navigation");
  if (!tree) return;
  const selected = preserveSelection ? tree.getSelectedId() : null;
  tree.clearAll();
  tree.parse(buildNavigationTree());
  tree.openAll();
  if (selected && tree.exists(selected)) {
    tree.select(selected);
  }
}

function handleTreeSelection(id) {
  if (id === "twoD-add" || id === "threeD-add" || id.startsWith("child-add::")) {
    if (!projectState.loaded) {
      webix.message({ type: "error", text: "Bitte zuerst ein Projekt erstellen oder laden." });
      return;
    }
    return;
  }
  updateWorkspace(id);
}

function updateWorkspace(nodeId) {
  const workspace = webix.$$("workspaceArea");
  if (!workspace) return;
  if (nodeId === "world") {
    syncWorldPanelValues();
    workspace.setValue("panel-world");
    return;
  }
  if (nodeId === "continents") {
    const panelId = ensureContinentsPanel();
    syncContinentsPanel();
    workspace.setValue(panelId);
    return;
  }
  if (nodeId === "biomes") {
    const panelId = ensureBiomesPanel();
    syncBiomesPanel();
    workspace.setValue(panelId);
    return;
  }
  const heightmapEntry = getHeightmapById(nodeId);
  if (heightmapEntry && heightmapEntry.node.mapType === "noise") {
    const panelId = ensureNoiseHeightmapPanel(heightmapEntry.node);
    syncNoiseHeightmapPanel(heightmapEntry.node);
    workspace.setValue(panelId);
    return;
  }
  if (heightmapEntry && heightmapEntry.node.mapType === "paint") {
    const panelId = ensurePaintHeightmapPanel(heightmapEntry.node);
    syncPaintHeightmapPanel(heightmapEntry.node);
    workspace.setValue(panelId);
    return;
  }
  if (heightmapEntry && heightmapEntry.node.mapType === "upload") {
    const panelId = ensureUploadHeightmapPanel(heightmapEntry.node);
    syncUploadHeightmapPanel(heightmapEntry.node);
    workspace.setValue(panelId);
    return;
  }
  if (heightmapEntry && heightmapEntry.node.mapType === "combine") {
    const panelId = ensureCombineHeightmapPanel(heightmapEntry.node);
    syncCombineHeightmapPanel(heightmapEntry.node);
    workspace.setValue(panelId);
    return;
  }
  const template = getPanelTemplate(nodeId);
  const panelId = ensureTemplatePanel(nodeId || "default", template);
  workspace.setValue(panelId);
}

function getActivePanelId() {
  const workspace = webix.$$("workspaceArea");
  if (!workspace) return null;
  if (typeof workspace.getValue === "function") {
    return workspace.getValue();
  }
  return workspace._active_id || null;
}

function handleNewWorldClick() {
  openNewWorldDialog(handleCreateWorldFromPayload);
}

function handleCreateWorldFromPayload(values) {
  createWorld(values);
  refreshNavigationTree();
  syncWorldPanelValues();
  setSaveButtonState(true);
  webix.message(`Projekt ${projectState.name} erstellt.`);
  selectNode("world");
}

function handleWorldFieldChange() {
  const form = webix.$$("worldSettingsForm");
  if (!form) {
    return;
  }
  const values = form.getValues();
  updateWorldSettings(values);
  refreshNavigationTree();
  syncWorldPanelValues();
  setSaveButtonState(true);
}

async function handleLoadWorld() {
  if (isLoading) return;
  const file = await pickTerrainFile();
  if (!file) return;
  isLoading = true;
  setSaveButtonState(false);
  webix.message("Lade Terrain Projekt ...");
  try {
    await loadTerrainFromFile(file);
    refreshNavigationTree();
    syncWorldPanelValues();
    webix.message({ type: "success", text: `Projekt ${projectState.name} geladen.` });
    setSaveButtonState(true);
    selectNode("world");
  } catch (error) {
    console.error("Terrain Load fehlgeschlagen", error);
    webix.alert({ type: "alert-error", text: `Terrain konnte nicht geladen werden: ${error?.message || error}` });
    setSaveButtonState(true);
  } finally {
    isLoading = false;
  }
}

async function handleSaveWorld() {
  if (!projectState.loaded) {
    webix.message({ type: "error", text: "Kein Projekt zum Speichern." });
    return;
  }
  if (isSaving) return;
  isSaving = true;
  setSaveButtonState(false);
  webix.message("Speichere Terrain ...");
  try {
    const { blob, filename } = await saveTerrainProject((msg) =>
      webix.message({ text: msg, expire: 1200, id: "terrain-progress" })
    );
    triggerDownload(blob, filename);
    webix.message({ type: "success", text: `Gespeichert: ${filename}` });
  } catch (error) {
    console.error("Terrain Save fehlgeschlagen", error);
    webix.alert({ type: "alert-error", text: `Terrain konnte nicht gespeichert werden: ${error?.message || error}` });
  } finally {
    isSaving = false;
    setSaveButtonState(true);
  }
}

function setSaveButtonState(enabled) {
  if (!saveButton) return;
  if (enabled) {
    saveButton.enable();
  } else {
    saveButton.disable();
  }
}

function selectNode(nodeId) {
  return new Promise((resolve) => {
    const tree = webix.$$("navigation");
    if (!tree) {
      resolve();
      return;
    }
    tree.select(nodeId);
    setTimeout(() => resolve(), 30);
  });
}

function handleTreeItemClick(id, e) {
  if (id === "twoD-add" || id === "threeD-add") {
    const bucket = id.startsWith("threeD") ? "threeD" : "twoD";
    showHeightmapAddMenu(bucket, e);
    return false;
  }
  if (id.startsWith("child-add::")) {
    const parentId = id.split("::")[1];
    const parentEntry = getHeightmapById(parentId);
    if (!parentEntry) {
      return false;
    }
    showHeightmapAddMenu(parentEntry.bucket, e, parentId);
    return false;
  }
  return true;
}

function getAddMenuData(bucket, parentId) {
  const base = [
    { id: "noise", value: "Noise Heightmap" },
    { id: "upload", value: "Upload Heightmap" },
    { id: "paint", value: "Paint Heightmap" },
    { id: "combine", value: "Combine Heightmap" },
  ];
  if (bucket === "threeD") {
    return base.filter((option) => option.id !== "combine");
  }
  return base;
}

function ensureHeightmapAddMenu() {
  if (heightmapAddMenu) return heightmapAddMenu;
  heightmapAddMenu = webix.ui({
    view: "contextmenu",
    id: "heightmapAddMenu",
    css: "webix_dark",
    data: [],
  });
  heightmapAddMenu.attachEvent("onMenuItemClick", (mapType) => {
    handleHeightmapCreation(mapType);
  });
  heightmapAddMenu.attachEvent("onItemClick", (mapType) => {
    handleHeightmapCreation(mapType);
  });
  return heightmapAddMenu;
}

function showHeightmapAddMenu(bucket, event, parentId = null) {
  if (!projectState.loaded) {
    webix.message({ type: "error", text: "Bitte zuerst ein Projekt erstellen oder laden." });
    return;
  }
  pendingAddBucket = bucket;
  pendingParentId = parentId;
  const menu = ensureHeightmapAddMenu();
  menu.clearAll();
  menu.parse(getAddMenuData(bucket, parentId));
  menu.show(event.target);
}

function handleHeightmapCreation(mapType) {
  const bucket = pendingAddBucket;
  const parentId = pendingParentId;
  if (!bucket) return;
  ensureHeightmapAddMenu().hide();
  pendingAddBucket = null;
  pendingParentId = null;
  if (!projectState.loaded) {
    webix.message({ type: "error", text: "Bitte zuerst ein Projekt erstellen oder laden." });
    return;
  }
  const node = createHeightmap(bucket, { mapType, parentId });
  refreshNavigationTree(false);
  selectNode(node.id);
}

function pickTerrainFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".terrain";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const file = input.files && input.files.length ? input.files[0] : null;
      input.remove();
      resolve(file);
    });
    input.click();
  });
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || "world.terrain";
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 50);
}

webix.ready(() => {
  initApp();
});
