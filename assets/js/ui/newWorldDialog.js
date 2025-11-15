import { WORLD_HEIGHT_LIMIT, WORLD_SIZE_OPTIONS } from "../config/constants.js";
import { getDefaultWorldFormValues } from "../state/projectState.js";

let dialog;
let currentSubmit;

function ensureDialog() {
  if (dialog) return dialog;

  dialog = webix.ui({
    view: "window",
    id: "newWorldDialog",
    width: 440,
    modal: true,
    position: "center",
    move: false,
    head: "Neue Welt erstellen",
    body: {
      rows: [
        {
          view: "form",
          id: "newWorldForm",
          borderless: true,
          elementsConfig: {
            labelWidth: 120,
          },
          elements: [
            {
              view: "text",
              name: "worldName",
              label: "World Name",
              placeholder: "World 01",
              required: true,
              invalidMessage: "Nutze A-Z, 0-9, Punkt, Unterstrich, Minus oder Leerzeichen.",
            },
            {
              view: "combo",
              name: "worldSize",
              label: "World Size",
              options: WORLD_SIZE_OPTIONS,
              required: true,
              invalidMessage: "Bitte eine Weltgröße auswählen.",
            },
            {
              view: "text",
              name: "worldHeight",
              label: "World Height",
              type: "number",
              attributes: { min: WORLD_HEIGHT_LIMIT.min, max: WORLD_HEIGHT_LIMIT.max },
              required: true,
              invalidMessage: `Wert zwischen ${WORLD_HEIGHT_LIMIT.min} und ${WORLD_HEIGHT_LIMIT.max} eingeben.`,
            },
          ],
          rules: {
            worldName: (value) => /^[A-Za-z0-9._\- ]+$/.test(value || ""),
            worldHeight: (value) => {
              const numeric = parseInt(value, 10);
              return numeric >= WORLD_HEIGHT_LIMIT.min && numeric <= WORLD_HEIGHT_LIMIT.max;
            },
          },
        },
        {
          cols: [
            {},
            {
              view: "button",
              value: "Abbrechen",
              width: 120,
              click: () => dialog.hide(),
            },
            {
              view: "button",
              value: "OK",
              width: 120,
              css: "webix_primary",
              click: () => handleSubmit(),
            },
          ],
        },
      ],
    },
  });

  return dialog;
}

function handleSubmit() {
  const form = webix.$$("newWorldForm");
  if (!form || !form.validate()) {
    return;
  }
  const values = form.getValues();
  values.worldSize = parseInt(values.worldSize, 10);
  values.worldHeight = parseInt(values.worldHeight, 10);
  if (currentSubmit) {
    currentSubmit(values);
  }
  dialog.hide();
}

export function openNewWorldDialog(onCreate) {
  const win = ensureDialog();
  currentSubmit = onCreate;
  const form = webix.$$("newWorldForm");
  if (form) {
    form.setValues(getDefaultWorldFormValues(), true);
    form.clearValidation();
    form.focus("worldName");
  }
  win.show();
}
