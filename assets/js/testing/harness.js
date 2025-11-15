export function registerHarness({ onCreateWorld, onSelectNode, getActivePanelId }) {
  window.AppHarness = {
    createWorld: (payload) => {
      if (typeof onCreateWorld === "function") {
        onCreateWorld(payload);
      }
    },
    selectNode: (nodeId) => {
      if (typeof onSelectNode !== "function") return Promise.resolve();
      return onSelectNode(nodeId);
    },
    getActivePanelId: () => {
      if (typeof getActivePanelId === "function") {
        return getActivePanelId();
      }
      return null;
    },
  };
}
