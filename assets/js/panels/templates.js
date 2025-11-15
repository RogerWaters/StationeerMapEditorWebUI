import { PANEL_TEMPLATES } from "../config/constants.js";

function renderHeightmapPanel(nodeId, label) {
  return `
    <div class='section-title'>${label}</div>
    <div class='notes'>
      Der Editor für ${nodeId} erscheint hier mit Canvas, Erosions- und Materialparametern.
    </div>
  `;
}

export function getPanelTemplate(nodeId) {
  if (PANEL_TEMPLATES[nodeId]) {
    return PANEL_TEMPLATES[nodeId];
  }
  if (nodeId && nodeId.startsWith("twoD-hm-")) {
    return renderHeightmapPanel(nodeId, "2D Heightmap");
  }
  if (nodeId && nodeId.startsWith("threeD-hm-")) {
    return renderHeightmapPanel(nodeId, "3D Heightmap");
  }
  return PANEL_TEMPLATES.default;
}

export function ensureTemplatePanel(nodeId, template) {
  const panelId = `panel-${nodeId}`;
  const workspace = webix.$$("workspaceArea");
  if (!workspace) {
    return "panel-default";
  }
  const existing = webix.$$(panelId);
  if (existing) {
    existing.define("template", template);
    existing.refresh();
    return panelId;
  }
  workspace.addView({
    id: panelId,
    view: "template",
    template,
    css: "webix_dark workspace-panel",
    borderless: true,
  });
  return panelId;
}
