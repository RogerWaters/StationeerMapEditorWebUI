import { defaultPanel } from "./panels/defaultPanel.js";
import { ensureTemplatePanel, getPanelTemplate } from "./panels/templates.js";
import { createWorldPanel, syncWorldPanelValues } from "./panels/worldPanel.js";
import { registerHarness } from "./testing/harness.js";
import { openNewWorldDialog } from "./ui/newWorldDialog.js";
import {
  buildNavigationTree,
  createHeightmap,
  createWorld,
  projectState,
  updateWorldSettings,
} from "./state/projectState.js";

let saveButton;

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
  if (id === "twoD-add" || id === "threeD-add") {
    if (!projectState.loaded) {
      webix.message({ type: "error", text: "Bitte zuerst ein Projekt erstellen oder laden." });
      return;
    }
    const newNode = createHeightmap(id.startsWith("threeD") ? "threeD" : "twoD");
    refreshNavigationTree(false);
    selectNode(newNode.id);
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

function handleLoadWorld() {
  webix.alert("Dateiauswahl folgt hier – .terrain Dateien werden zukünftig geladen.");
}

function handleSaveWorld() {
  if (!projectState.loaded) {
    webix.message({ type: "error", text: "Kein Projekt zum Speichern." });
    return;
  }
  webix.alert("Speichern als .terrain folgt – XML Export wird implementiert.");
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

webix.ready(() => {
  initApp();
});
