import {
  ensureBiomeRegions,
  getBiomeRegions,
  projectState,
  updateBiomeRegion,
  updateBiomeGlobals,
  getBiomeGlobals,
} from "../state/projectState.js";
import { schedulePreview } from "../services/previewService.js";
import { buildBiomesPreviewJob } from "../services/biomePreviewBuilder.js";

function section(title, notes = "") {
  return {
    template: `
      <div class="section-title">${title}</div>
      ${notes ? `<div class="notes">${notes}</div>` : ""}
    `,
    borderless: true,
    autoheight: true,
  };
}

function spacer(height = 12) {
  return { height, borderless: true };
}

function heightmapOptions() {
  const opts = [{ id: "", value: "Keine Heightmap" }];
  const pool = projectState.heightmaps.twoD || [];
  pool.forEach((hm) => opts.push({ id: hm.id, value: hm.value }));
  return opts;
}

const blendModOptions = () => heightmapOptions();

export function ensureBiomesPanel() {
  const panelId = "panel-biomes";
  const workspace = webix.$$("workspaceArea");
  if (!workspace) return panelId;
  if (webix.$$(panelId)) return panelId;
  workspace.addView({
    id: panelId,
    css: "webix_dark workspace-panel",
    type: "clean",
    cols: [
      {
        gravity: 2,
        rows: [
          {
            template:
              "<div style='padding:24px 24px 16px'><div class='section-title'>Biomes</div><div class='notes'>Weise jeder Region eine Heightmap zu und konfiguriere Blend-Übergänge.</div></div>",
            borderless: true,
            autoheight: true,
          },
          {
            view: "scrollview",
            css: "workspace-panel-scroll",
            body: {
              rows: [
                {
                  view: "form",
                  borderless: true,
                  padding: { top: 0, left: 24, right: 24, bottom: 24 },
                  elements: [
                    {
                      cols: [
                        { view: "button", value: "Regionen synchronisieren", css: "webix_secondary", click: syncRegionsWithContinents },
                        {},
                      ],
                    },
                    spacer(12),
                    section("Regionen", "Wähle eine Region aus, um die Heightmap-Zuordnung zu bearbeiten."),
                    {
                      view: "list",
                      id: "biomeRegionList",
                      height: 220,
                      select: true,
                      css: "webix_dark",
                      template: (obj) => {
                        const hm = obj.heightmapLabel ? ` • ${obj.heightmapLabel}` : "";
                        return `<div><strong>${obj.name}</strong>${hm}</div>`;
                      },
                      on: {
                        onAfterSelect: syncRegionForm,
                      },
                    },
                    spacer(18),
                    section("Zuordnung"),
                    {
                      view: "combo",
                      id: "biomeField-heightmap",
                      label: "Heightmap",
                      labelWidth: 140,
                      options: heightmapOptions(),
                      on: {
                        onChange: (value) => updateRegionField("heightmapId", value || null),
                      },
                    },
                    spacer(18),
                    section("Blending", "Übergänge zwischen Regionen weich gestalten."),
                    {
                      view: "slider",
                      id: "biomeField-blendRadius",
                      label: "Blend Radius",
                      labelWidth: 140,
                      value: 32,
                      min: 0,
                      max: 256,
                      on: {
                        onChange: (value) => updateGlobalsField("blendRadius", value),
                      },
                    },
                    spacer(8),
                    {
                      view: "slider",
                      id: "biomeField-blendFeather",
                      label: "Feather",
                      labelWidth: 140,
                      value: 0.5,
                      min: 0,
                      max: 1,
                      step: 0.01,
                      on: {
                        onChange: (value) => updateGlobalsField("blendFeather", value),
                      },
                    },
                    spacer(8),
                    {
                      view: "combo",
                      id: "biomeField-blendModHeightmapId",
                      label: "Blend Heightmap",
                      labelWidth: 140,
                      options: blendModOptions(),
                      on: {
                        onChange: (value) => updateGlobalsField("blendModHeightmapId", value || null),
                      },
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
      { view: "resizer" },
      {
        gravity: 1,
        rows: [
          {
            template:
              "<div style='padding:24px 24px 4px'><div class='section-title'>Preview</div><div class='notes'>Blending-Vorschau in Weltauflösung.</div></div>",
            borderless: true,
            autoheight: true,
          },
          {
            view: "template",
            css: "noise-preview-container",
            borderless: true,
            gravity: 1,
            template: `
              <div class='noise-preview-wrapper combine-preview'>
                <div id='biomesPreviewStatus' class='noise-preview-status'>Noch keine Vorschau</div>
                <img id='biomesPreviewImg' class='noise-preview-image' alt='Biomes preview' />
                <div id='biomesPreviewMeta' class='noise-preview-status' style='bottom:12px; left:12px; top:auto;'>-</div>
              </div>
            `,
          },
        ],
      },
    ],
  });
  syncBiomesPanel();
  return panelId;
}

export function syncBiomesPanel() {
  const regionCount = projectState.continents?.continentCount || 0;
  const regions = ensureBiomeRegions(regionCount);
  const list = webix.$$("biomeRegionList");
  if (list) {
    const data = regions.map((region, index) => ({
      id: `region-${index}`,
      regionIndex: index,
      name: region.name || `Region ${index + 1}`,
      heightmapLabel: region.heightmapId ? getHeightmapLabel(region.heightmapId) : "Keine Heightmap",
    }));
    list.clearAll();
    list.parse(data);
    if (data.length) {
        list.select(data[0].id);
    }
  }
  const heightmapField = webix.$$("biomeField-heightmap");
  if (heightmapField) {
    heightmapField.define("options", heightmapOptions());
    heightmapField.refresh();
  }
  const blendModField = webix.$$("biomeField-blendModHeightmapId");
  if (blendModField) {
    blendModField.define("options", blendModOptions());
    blendModField.refresh();
  }
  syncRegionForm();
  syncGlobalBlendFields();
  scheduleBiomesPreview();
}

function syncRegionForm() {
  const list = webix.$$("biomeRegionList");
  const selected = list ? list.getSelectedId() : null;
  const selectedItem = list && selected ? list.getItem(selected.id || selected) : null;
  const index = Number.isFinite(selectedItem?.regionIndex) ? selectedItem.regionIndex : 0;
  const regions = getBiomeRegions();
  const region = regions[index] || regions[0];
  const setValue = (id, value) => {
    const view = webix.$$(id);
    if (view) {
      view.blockEvent();
      view.setValue(value);
      view.unblockEvent();
    }
  };
  if (region) {
    setValue("biomeField-heightmap", region.heightmapId || "");
    setValue("biomeField-blendRadius", region.blendRadius ?? 32);
    setValue("biomeField-blendFeather", region.blendFeather ?? 0.5);
  }
}

function updateRegionField(key, value) {
  const list = webix.$$("biomeRegionList");
  const selected = list ? list.getSelectedId() : null;
  if (!selected) return;
  const item = list.getItem(selected.id || selected);
  const index = Number.isFinite(item?.regionIndex) ? item.regionIndex : null;
  if (!Number.isFinite(index)) return;
  const regions = getBiomeRegions();
  if (!regions[index]) return;
  const next = updateBiomeRegion(index, { [key]: value });
  if (list && next) {
    const label = key === "heightmapId" ? getHeightmapLabel(value) : list.getItem(selectedId).heightmapLabel;
    const updated = { ...item, heightmapLabel: label };
    list.updateItem(item.id, updated);
  }
  scheduleBiomesPreview();
}

function updateGlobalsField(key, value) {
  updateBiomeGlobals({ [key]: value });
  syncGlobalBlendFields();
  scheduleBiomesPreview();
}

function syncGlobalBlendFields() {
  const globals = getBiomeGlobals();
  const setValue = (id, value) => {
    const view = webix.$$(id);
    if (!view) return;
    view.blockEvent();
    view.setValue(value);
    view.unblockEvent();
  };
  setValue("biomeField-blendRadius", globals.blendRadius ?? 32);
  setValue("biomeField-blendFeather", globals.blendFeather ?? 0.5);
  setValue("biomeField-blendModHeightmapId", globals.blendModHeightmapId || "");
}

function getHeightmapLabel(id) {
  if (!id) return "Keine Heightmap";
  const match = (projectState.heightmaps.twoD || []).find((hm) => hm.id === id);
  return match ? match.value : id;
}

function syncRegionsWithContinents() {
  const regionCount = projectState.continents?.continentCount || 0;
  ensureBiomeRegions(regionCount);
  syncBiomesPanel();
}

function scheduleBiomesPreview() {
  const size = projectState.spec.size || 512;
  const metaEl = document.getElementById("biomesPreviewMeta");
  if (metaEl) {
    metaEl.textContent = `${size} x ${size}`;
  }
  schedulePreview({
    nodeId: "biomes",
    width: size,
    height: size,
    statusId: "biomesPreviewStatus",
    imageId: "biomesPreviewImg",
    buildJob: () => buildBiomesPreviewJob(),
  });
}
