export function registerHarness({ onCreateWorld, onSelectNode, getActivePanelId, createHeightmapNode }) {
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
    createHeightmap: (config) => {
      if (typeof createHeightmapNode === "function") {
        return createHeightmapNode(config || {});
      }
      return null;
    },
  };
}
