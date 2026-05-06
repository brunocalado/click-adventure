/**
 * Per-node configuration panel. Opened via double-click on a node in ManagerApp.
 * Manages a list of images per node (multi-image support) and an activeImageIndex
 * that drives the Manager thumbnail and the tile texture when this node is current.
 * Changes are staged locally; the activeImageIndex is the only value that persists
 * immediately (to update the tile without waiting for Save).
 *
 * Lifecycle hook: renderNodeConfigApp
 */

import { syncNodeTile, getGraphData, saveGraphData } from "./node-utils.js";

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
    /** @type {Array<{id:string,src:string,label:string}>|null} */
    this._pendingImages = null;
    /** @type {number|null} */
    this._pendingActiveIndex = null;
    /** @type {string|null} */
    this._pendingLabel = null;
    /**
     * Tracks whether the user staged this node as the start point without saving yet.
     * null = no pending change; true = user wants this to be the start node.
     * Committed to the graph setting only on _saveAll.
     * @type {boolean|null}
     */
    this._pendingStartNode = null;
  }



  /**
   * Provides node data including the working images list and activeIndex to the template.
   * Migrates legacy imageSrc nodes on the fly — committed only on Save.
   * Triggered during the ApplicationV2 _prepareContext lifecycle stage.
   *
   * @override
   * @param {object} options
   * @returns {Promise<object>}
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const { nodes, startNodeId } = getGraphData();
    const node = nodes.find(n => n.id === this.nodeId)
      ?? { id: this.nodeId, label: "Scene", images: [], activeImageIndex: 0, x: 0, y: 0 };

    let images = Array.isArray(node.images) ? node.images : [];
    if (images.length === 0 && node.imageSrc) {
      images = [{ id: foundry.utils.randomID(), src: node.imageSrc, label: "Default" }];
    }

    const activeIndex = this._pendingActiveIndex ?? node.activeImageIndex ?? 0;
    const workingImages = this._pendingImages ?? images;

    context.node = node;
    context.nodeLabel = this._pendingLabel ?? node.label ?? "Scene";
    context.isStartNode = this._pendingStartNode ?? (startNodeId === this.nodeId);
    context.images = workingImages.map((img, i) => ({
      ...img,
      index: i,
      isActive: i === activeIndex
    }));
    context.activeIndex = activeIndex;
    return context;
  }

  /**
   * Wires all image management actions: add, set-active, remove, rename, save, delete.
   * Triggered during the ApplicationV2 _onRender lifecycle stage.
   *
   * @override
   * @param {object} context
   * @param {object} options
   */
  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;

    html.querySelector("[data-action='toggle-start']")?.addEventListener("click", () => {
      const { startNodeId } = getGraphData();
      const currentlyStart = this._pendingStartNode ?? (startNodeId === this.nodeId);
      if (currentlyStart) return;

      // Stage the intent locally — nothing is written until Save
      this._pendingStartNode = true;

      const btn = html.querySelector("[data-action='toggle-start']");
      if (btn) {
        btn.textContent = "★ Start";
        btn.title = "This is the start node (click another node to change)";
        btn.classList.add("ca-toggle-start--active");
      }
    });

    html.querySelector("[data-action='add-image']")?.addEventListener("click", () => {
      const FilePickerClass = foundry.applications.apps.FilePicker.implementation
        ?? foundry.applications.apps.FilePicker;
      new FilePickerClass({
        type: "image",
        callback: (path) => {
          const images = this._getWorkingImages();
          images.push({ id: foundry.utils.randomID(), src: path, label: "Image " + (images.length + 1) });
          this._pendingImages = images;
          this.render({ force: true });
        }
      }).browse();
    });

    // Persists immediately so the tile updates if this is the current node
    html.querySelectorAll("[data-action='set-active']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const idx = parseInt(btn.dataset.index, 10);
        this._pendingActiveIndex = idx;
        await this._saveActiveIndex(idx);
        this.render({ force: true });
      });
    });

    html.querySelectorAll("[data-action='remove-image']").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.index, 10);
        const images = this._getWorkingImages();
        images.splice(idx, 1);
        this._pendingImages = images;
        const currentActive = this._pendingActiveIndex ?? context.activeIndex;
        if (currentActive >= images.length) {
          this._pendingActiveIndex = Math.max(0, images.length - 1);
        }
        this.render({ force: true });
      });
    });

    html.querySelectorAll(".ca-image-label-input").forEach(input => {
      input.addEventListener("change", () => {
        const idx = parseInt(input.dataset.index, 10);
        const images = this._getWorkingImages();
        if (images[idx]) images[idx].label = input.value.trim() || "Image";
        this._pendingImages = images;
      });
    });

    html.querySelector("[data-action='save']")?.addEventListener("click", async () => {
      const labelInput = html.querySelector(".ca-node-label-input");
      const label = labelInput?.value.trim().slice(0, 100) || "Scene";
      await this._saveAll(label);
    });

    html.querySelector("[data-action='delete-node']")?.addEventListener("click", async () => {
      await this._deleteNode();
    });
  }

  /**
   * Returns a mutable copy of the working images array, preferring pending state over persisted.
   * Handles legacy imageSrc-only nodes by wrapping in a single-item array.
   * @returns {Array<{id:string, src:string, label:string}>}
   */
  _getWorkingImages() {
    if (this._pendingImages !== null) return [...this._pendingImages];
    const { nodes } = getGraphData();
    const node = nodes.find(n => n.id === this.nodeId);
    let images = Array.isArray(node?.images) ? node.images : [];
    if (images.length === 0 && node?.imageSrc) {
      images = [{ id: foundry.utils.randomID(), src: node.imageSrc, label: "Default" }];
    }
    return [...images];
  }

  /**
   * Persists the active image index immediately and syncs the node's managed background
   * tile via syncNodeTile. Called without waiting for the Save button.
   *
   * @param {number} index
   * @returns {Promise<void>}
   */
  async _saveActiveIndex(index) {
    const { sceneId, startNodeId, nodes, links } = getGraphData();
    const images = this._getWorkingImages();
    const updatedNodes = nodes.map(n => {
      if (n.id !== this.nodeId) return n;
      return { ...n, images, activeImageIndex: index };
    });
    await saveGraphData({ sceneId, startNodeId, nodes: updatedNodes, links });

    // Sync the tile in this node's own scene immediately
    const updatedNode = updatedNodes.find(n => n.id === this.nodeId);
    if (updatedNode) await syncNodeTile(updatedNode);

    const manager = foundry.applications.instances.get("manager-app");
    if (manager?.rendered) manager.render({ force: true });
  }

  /**
   * Persists all pending changes (label + images + activeIndex) in a single settings write.
   * Also syncs the scene name and background tile for this node's Foundry Scene.
   * Clears pending state, refreshes ManagerApp, and closes the panel.
   *
   * @param {string} label
   * @returns {Promise<void>}
   */
  async _saveAll(label) {
    const { sceneId, startNodeId: persistedStartNodeId, nodes, links } = getGraphData();
    const startNodeId = this._pendingStartNode ? this.nodeId : persistedStartNodeId;
    const images = this._getWorkingImages();
    const activeIndex = this._pendingActiveIndex ?? 0;
    const updatedNodes = nodes.map(n => {
      if (n.id !== this.nodeId) return n;
      return { ...n, label, images, activeImageIndex: activeIndex, imageSrc: undefined };
    });
    await saveGraphData({ sceneId, startNodeId, nodes: updatedNodes, links });

    // Reset all users' position to the new start node in a single batch [V14]
    if (this._pendingStartNode && startNodeId !== persistedStartNodeId) {
      const userUpdates = game.users.map(u => ({
        _id: u.id,
        flags: { "click-adventure": { "currentNodeId": startNodeId } }
      }));
      await User.updateDocuments(userUpdates);
    }

    const updatedNode = updatedNodes.find(n => n.id === this.nodeId);
    if (updatedNode?.sceneId) {
      const scene = game.scenes.get(updatedNode.sceneId);
      if (scene) {
        const activeImg = images[activeIndex] ?? images[0] ?? null;
        const navName = activeImg?.label?.trim() || "";
        const sceneUpdate = {};
        if (scene.name !== label) sceneUpdate.name = label;
        if (scene.navName !== navName) sceneUpdate.navName = navName;
        if (Object.keys(sceneUpdate).length) await scene.update(sceneUpdate);
      }
      await syncNodeTile(updatedNode);
    }

    this._pendingImages = null;
    this._pendingActiveIndex = null;
    this._pendingLabel = null;
    this._pendingStartNode = null;

    const manager = foundry.applications.instances.get("manager-app");
    if (manager?.rendered) manager.render({ force: true });
    this.close();
  }

  /**
   * Deletes this node, all associated links, and its Foundry Scene after user confirmation.
   * Refreshes ManagerApp after deletion.
   *
   * @returns {Promise<void>}
   */
  async _deleteNode() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete Node" },
      content: "<p>Delete this node, all its connections, and its Foundry Scene?</p>",
      rejectClose: false
    });
    if (!confirmed) return;

    const { sceneId, startNodeId, nodes, links } = getGraphData();
    const deletedNode = nodes.find(n => n.id === this.nodeId);

    if (deletedNode?.sceneId) {
      const scene = game.scenes.get(deletedNode.sceneId);
      await scene?.delete();
    }

    const filteredNodes = nodes.filter(n => n.id !== this.nodeId);
    const filteredLinks = links.filter(l =>
      l.sourceId !== this.nodeId && l.targetId !== this.nodeId
    );
    // Clear startNodeId if the deleted node was the start
    const newStartNodeId = startNodeId === this.nodeId ? (filteredNodes[0]?.id ?? "") : startNodeId;
    await saveGraphData({ sceneId, startNodeId: newStartNodeId, nodes: filteredNodes, links: filteredLinks });

    const manager = foundry.applications.instances.get("manager-app");
    if (manager?.rendered) manager.render({ force: true });
    this.close();
  }
}
