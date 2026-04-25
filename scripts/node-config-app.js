/**
 * Per-node configuration panel. Opened via double-click on a node in ManagerApp.
 * Allows the user to edit the node label and choose a background image via FilePicker.
 *
 * Lifecycle hook: renderNodeConfigApp
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class NodeConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static BASE_APPLICATION = ApplicationV2;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "node-config-app",
    classes: ["click-adventure", "node-config"],
    window: { title: "Node Configuration" },
    position: { width: 360, height: "auto" }
  };

  /** @override */
  static PARTS = {
    config: {
      template: "modules/click-adventure/templates/node-config-app.hbs"
    }
  };

  /**
   * @param {string} nodeId - ID of the node being configured.
   * @param {object} [options={}]
   */
  constructor(nodeId, options = {}) {
    super(options);
    this.nodeId = nodeId;
  }

  /** @returns {{ nodes: object[], links: object[] }} */
  _graphData() {
    const graph = game.settings.get("click-adventure", "graph");
    return typeof graph?.toObject === "function" ? graph.toObject() : (graph ?? { nodes: [], links: [] });
  }

  /**
   * Fetches the node from the setting and supplies it to the template.
   * Triggered during the ApplicationV2 _prepareContext lifecycle stage.
   *
   * @override
   * @param {object} options
   * @returns {Promise<object>}
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const { nodes } = this._graphData();
    context.node = nodes.find(n => n.id === this.nodeId)
      ?? { id: this.nodeId, label: "Scene", imageSrc: "", x: 0, y: 0 };
    return context;
  }

  /**
   * Wires the FilePicker button and label save button.
   * Placed in _onRender (not _attachListeners) because HandlebarsApplicationMixin
   * recreates the part DOM on each render, making _onRender the reliable hook.
   * Triggered during the ApplicationV2 _onRender lifecycle stage.
   *
   * @override
   * @param {object} context
   * @param {object} options
   */
  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;

    html.querySelector("[data-action='pick-image']")?.addEventListener("click", () => {
      const FilePickerClass = foundry.applications.apps.FilePicker.implementation ?? foundry.applications.apps.FilePicker;
      new FilePickerClass({
        type: "image",
        callback: async (path) => {
          await this._saveField("imageSrc", path);
        }
      }).browse();
    });

    html.querySelector("[data-action='save-label']")?.addEventListener("click", async () => {
      const input = html.querySelector(".ca-node-label-input");
      await this._saveField("label", input?.value.trim() || "Scene");
    });
  }

  /**
   * Persists a single node field update and refreshes both NodeConfigApp and ManagerApp.
   *
   * @param {string} field - Node property name to update.
   * @param {string} value - New value.
   * @returns {Promise<void>}
   */
  async _saveField(field, value) {
    const { nodes: rawNodes, links } = this._graphData();
    const nodes = rawNodes.map(n => n.id === this.nodeId ? { ...n, [field]: value } : n);
    await game.settings.set("click-adventure", "graph", { nodes, links });

    // Refresh the manager without rebuilding its document listeners
    if (globalThis.ClickAdventure?._manager?.rendered) {
      globalThis.ClickAdventure._manager.render({ force: true });
    }
    this.render({ force: true });
  }
}
