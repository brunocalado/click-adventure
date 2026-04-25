/**
 * Per-node configuration panel. Opened via double-click on a node in ManagerApp.
 * Allows the user to edit the node label and choose a background image via FilePicker.
 * Changes to label and image are staged locally and committed together on Save.
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
    this._pendingImageSrc = null;
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
   * Wires the FilePicker button, unified Save, and Delete button.
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

    // FilePicker — stores picked path in a temporary instance variable
    // until Save is clicked, so partial edits don't auto-commit
    html.querySelector("[data-action='pick-image']")?.addEventListener("click", () => {
      const FilePickerClass = foundry.applications.apps.FilePicker.implementation
        ?? foundry.applications.apps.FilePicker;
      new FilePickerClass({
        type: "image",
        callback: (path) => {
          // Store temporarily; committed on Save
          this._pendingImageSrc = path;
          // Show a preview immediately without saving
          const preview = html.querySelector(".ca-node-preview");
          if (preview) {
            preview.innerHTML = `<img src="${path}" class="ca-node-preview-image" alt="preview"/>`;
          }
        }
      }).browse();
    });

    // Unified Save — commits label + any pending image change
    html.querySelector("[data-action='save']")?.addEventListener("click", async () => {
      const input = html.querySelector(".ca-node-label-input");
      const label = input?.value.trim() || "Scene";
      await this._saveAll(label);
    });

    // Delete — removes this node and all its links from the graph
    html.querySelector("[data-action='delete-node']")?.addEventListener("click", async () => {
      await this._deleteNode();
    });
  }

  /**
   * Persists the node's label and any pending imageSrc change in a single settings write.
   * Refreshes ManagerApp and closes this panel.
   *
   * @param {string} label
   * @returns {Promise<void>}
   */
  async _saveAll(label) {
    const { nodes: rawNodes, links } = this._graphData();
    const nodes = rawNodes.map(n => {
      if (n.id !== this.nodeId) return n;
      return {
        ...n,
        label,
        imageSrc: this._pendingImageSrc ?? n.imageSrc
      };
    });
    await game.settings.set("click-adventure", "graph", { nodes, links });
    this._pendingImageSrc = null;

    if (globalThis.ClickAdventure?._manager?.rendered) {
      globalThis.ClickAdventure._manager.render({ force: true });
    }
    this.close();
  }

  /**
   * Deletes this node and all associated links after user confirmation.
   * Refreshes ManagerApp after deletion.
   *
   * @returns {Promise<void>}
   */
  async _deleteNode() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete Node" },
      content: "<p>Delete this node and all its connections?</p>",
      rejectClose: false
    });
    if (!confirmed) return;

    const { nodes, links } = this._graphData();
    const filteredNodes = nodes.filter(n => n.id !== this.nodeId);
    const filteredLinks = links.filter(l =>
      l.sourceId !== this.nodeId && l.targetId !== this.nodeId
    );
    await game.settings.set("click-adventure", "graph", {
      nodes: filteredNodes,
      links: filteredLinks
    });

    if (globalThis.ClickAdventure?._manager?.rendered) {
      globalThis.ClickAdventure._manager.render({ force: true });
    }
    this.close();
  }
}
