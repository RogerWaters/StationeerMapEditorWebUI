import {
  COMBINE_HEIGHTMAP_DEFAULTS,
  getHeightmapById,
  projectState,
  updateHeightmapSettings,
} from "../state/projectState.js";

const METHOD_OPTIONS = [
  { id: "add", value: "Add (A + B)" },
  { id: "subtract", value: "Subtract (A - B)" },
  { id: "multiply", value: "Multiply (A * B)" },
  { id: "divide", value: "Divide (A / B)" },
  { id: "average", value: "Average ((A + B)/2)" },
  { id: "max", value: "Max (higher value)" },
  { id: "min", value: "Min (lower value)" },
  { id: "pow", value: "Power (A ^ B)" },
  { id: "log", value: "Log (log_A(B))" },
];

const CHILD_KEYS = [
  { key: "childA", label: "Heightmap A" },
  { key: "childB", label: "Heightmap B" },
];

export function ensureCombineHeightmapPanel(node) {
  const panelId = `panel-combine-${node.id}`;
  const formId = `combineHeightmapForm-${node.id}`;
  const workspace = webix.$$("workspaceArea");
  if (!workspace) return panelId;
  if (webix.$$(panelId)) {
    return panelId;
  }
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
              "<div style='padding:24px 24px 8px'><div class='section-title'>Combine Heightmap</div><div class='notes'>Kombiniere zwei Heightmaps mittels mathematischer Operationen.</div></div>",
            borderless: true,
            autoheight: true,
          },
          {
            view: "scrollview",
            body: {
              view: "form",
              id: formId,
              borderless: true,
              padding: { top: 0, left: 24, right: 24, bottom: 24 },
              elementsConfig: { labelWidth: 160 },
              elements: buildFormElements(node),
            },
          },
        ],
      },
      { view: "resizer" },
      {
        gravity: 1,
        padding: 24,
        rows: [
          renderChildOverview(node.id),
          { height: 10, borderless: true },
          {
            template:
              "<div class='notes'>Nutze den Projektbaum, um unterhalb dieser Combine-Heightmap weitere Heightmaps anzulegen. Slots werden automatisch befüllt.</div>",
            borderless: true,
            autoheight: true,
          },
        ],
      },
    ],
  });
  const form = webix.$$(formId);
  if (form) {
    bindCombineFormEvents(form, node.id);
  }
  syncCombineHeightmapPanel(node);
  return panelId;
}

export function syncCombineHeightmapPanel(node) {
  const form = webix.$$(`combineHeightmapForm-${node.id}`);
  const values = normalizeCombineSettings(node);
  if (form) {
    form.blockEvent();
    form.setValues(values, true);
    form.unblockEvent();
  }
  const overview = webix.$$(`combineChildren-${node.id}`);
  if (overview) {
    overview.setHTML(renderChildOverviewHTML(node.id));
  }
}

function buildFormElements(node) {
  const values = normalizeCombineSettings(node);
  return [
    {
      view: "text",
      name: "displayName",
      label: "Name",
      value: node.value,
    },
    { height: 16, borderless: true },
    {
      cols: [
        { view: "combo", name: "method", label: "Method", options: METHOD_OPTIONS, value: values.method },
        { width: 16 },
        { view: "checkbox", name: "normalizeResult", labelRight: "Normalize Result", value: values.normalizeResult ? 1 : 0 },
      ],
    },
    { height: 16, borderless: true },
    ...CHILD_KEYS.flatMap((child) => buildChildSection(node.id, child, values[child.key])),
  ];
}

function buildChildSection(nodeId, { key, label }, values) {
  return [
    {
      template: `<div class='section-title'>${label}</div><div class='notes'>Zuordnung über den Projektbaum</div>`,
      borderless: true,
      autoheight: true,
    },
    {
      cols: [
        { view: "checkbox", name: `${key}.normalize`, labelRight: "Normalize", value: values.normalize ? 1 : 0 },
        { width: 16 },
        { view: "text", name: `${key}.offset`, label: "Offset", value: values.offset },
        { width: 16 },
        { view: "text", name: `${key}.factor`, label: "Factor", value: values.factor },
      ],
    },
    { height: 12, borderless: true },
  ];
}

function normalizeCombineSettings(node) {
  const base = { ...COMBINE_HEIGHTMAP_DEFAULTS, ...(node.settings || {}) };
  return {
    ...base,
    childA: {
      ...COMBINE_HEIGHTMAP_DEFAULTS.childA,
      ...(base.childA || {}),
    },
    childB: {
      ...COMBINE_HEIGHTMAP_DEFAULTS.childB,
      ...(base.childB || {}),
    },
  };
}

function bindCombineFormEvents(form, nodeId) {
  form.getChildViews().forEach((view) => attachCombineListeners(view, nodeId));
}

function attachCombineListeners(view, nodeId) {
  if (view.config && view.config.name && !view.config.__combineBound) {
    view.config.__combineBound = true;
    view.attachEvent("onChange", (value) => handleCombineControlChange(nodeId, view.config.name, value));
  }
  const children = view.getChildViews ? view.getChildViews() : [];
  children.forEach((child) => attachCombineListeners(child, nodeId));
}

function handleCombineControlChange(nodeId, name, rawValue) {
  if (name === "displayName") {
    const trimmed = (rawValue || "").trim();
    updateHeightmapSettings(nodeId, { displayName: trimmed });
    const tree = webix.$$("navigation");
    if (tree && tree.exists(nodeId)) {
      const item = tree.getItem(nodeId);
      item.value = trimmed || item.value;
      tree.updateItem(nodeId, item);
    }
    return;
  }
  if (name === "method") {
    updateHeightmapSettings(nodeId, { method: rawValue });
    return;
  }
  if (name === "normalizeResult") {
    updateHeightmapSettings(nodeId, { normalizeResult: !!rawValue });
    return;
  }
  const childMatch = name.match(/^(child[AB])\.(.+)$/);
  if (childMatch) {
    const [, childKey, prop] = childMatch;
    const entry = getHeightmapById(nodeId);
    const current = normalizeCombineSettings(entry.node)[childKey];
    const next = { ...current };
    if (prop === "normalize") {
      next.normalize = !!rawValue;
    } else if (prop === "offset") {
      next.offset = parseFloat(rawValue) || 0;
    } else if (prop === "factor") {
      next.factor = parseFloat(rawValue) || 0;
    }
    updateHeightmapSettings(nodeId, { [childKey]: next });
  }
}

function renderChildOverview(nodeId) {
  return {
    id: `combineChildren-${nodeId}`,
    view: "template",
    borderless: true,
    template: renderChildOverviewHTML(nodeId),
  };
}

function renderChildOverviewHTML(nodeId) {
  const entry = getHeightmapById(nodeId);
  const children = entry?.node.children || [];
  if (!children.length) {
    return "<div class='notes'>Noch keine untergeordneten Heightmaps.</div>";
  }
  const items = children
    .slice(0, 2)
    .map((childId, index) => {
      const childEntry = getHeightmapById(childId);
      const label = childEntry?.node.value || childId;
      return `<div class='combine-child'>Slot ${index + 1}: ${label}</div>`;
    })
    .join("");
  return `<div class='notes'>Zuordnungen:</div>${items}`;
}
