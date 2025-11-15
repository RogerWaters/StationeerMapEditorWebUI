import { WORLD_HEIGHT_LIMIT, WORLD_SIZE_OPTIONS } from "../config/constants.js";
import { projectState } from "../state/projectState.js";

export function createWorldPanel(onFieldChange) {
  return {
    id: "panel-world",
    css: "webix_dark workspace-panel",
    type: "clean",
    padding: 0,
    rows: [
      {
        template:
          "<div style='padding:24px 24px 0'><div class='section-title'>World Settings</div><div class='notes'>Passe Grundparameter deiner Welt an.</div></div>",
        borderless: true,
        autoheight: true,
      },
      {
        view: "scrollview",
        css: "workspace-panel-scroll",
        scroll: "y",
        gravity: 1,
        borderless: true,
        body: {
          view: "form",
          id: "worldSettingsForm",
          borderless: true,
          padding: 24,
          elementsConfig: { labelWidth: 150 },
          elements: [
            {
              view: "text",
              name: "worldName",
              label: "World Name",
              required: true,
              invalidMessage: "Nutze A-Z, 0-9, Punkt, Unterstrich, Minus oder Leerzeichen.",
            },
            {
              view: "combo",
              name: "worldSize",
              label: "World Size",
              options: WORLD_SIZE_OPTIONS,
              required: true,
            },
            {
              view: "text",
              name: "worldHeight",
              label: "World Height",
              type: "number",
              attributes: { min: WORLD_HEIGHT_LIMIT.min, max: WORLD_HEIGHT_LIMIT.max },
              required: true,
              invalidMessage: `Wert zwischen ${WORLD_HEIGHT_LIMIT.min} und ${WORLD_HEIGHT_LIMIT.max}.`,
            },
          ],
          rules: {
            worldName: (value) => /^[A-Za-z0-9._\- ]+$/.test(value || ""),
            worldHeight: (value) => {
              const numeric = parseInt(value, 10);
              return numeric >= WORLD_HEIGHT_LIMIT.min && numeric <= WORLD_HEIGHT_LIMIT.max;
            },
          },
          on: {
            onChange(_value, _old, details) {
              if (typeof onFieldChange === "function") {
                onFieldChange(details?.name);
              }
            },
            onAfterValidation(status) {
              if (!status) return;
              if (typeof onFieldChange === "function") {
                onFieldChange();
              }
            },
          },
        },
      },
    ],
  };
}

export function syncWorldPanelValues() {
  const form = webix.$$("worldSettingsForm");
  if (!form) return;
  form.clearValidation();
  form.setValues(
    {
      worldName: projectState.name,
      worldSize: projectState.spec.size,
      worldHeight: projectState.spec.height,
    },
    true
  );
}
