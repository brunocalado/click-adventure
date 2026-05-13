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

/**
 * Resolves a Foundry Macro from a drag-drop event.
 * Accepts both world macros and compendium macros.
 * Compendium macros are imported to the world before being returned,
 * since macro.execute() requires a world document.
 * Reuses an existing world macro of the same name to avoid duplicates.
 *
 * @param {DragEvent} event
 * @returns {Promise<Macro|null>}
 */
async function _resolveMacroFromDrop(event) {
  let data;
  try { data = JSON.parse(event.dataTransfer.getData("text/plain")); }
  catch { return null; }

  if (data?.type !== "Macro" || !data?.uuid) return null;

  let macro = await fromUuid(data.uuid);
  if (!macro) return null;

  if (macro.pack) {
    const pack = game.packs.get(macro.pack);
    if (!pack) return null;
    const existing = game.macros.find(m => m.name === macro.name && !m.pack);
    if (existing) {
      macro = existing;
    } else {
      macro = await game.macros.importFromCompendium(pack, macro.id);
      ui.notifications.info(`Click Adventure: Macro "${macro.name}" imported from compendium.`);
    }
  }

  return macro;
}

const TRIGGER_OPTIONS = [
  { value: "gm-activate", label: "GM Activate → GM only"         },
  { value: "player-view", label: "Player View → Player only"     },
  { value: "gm-view",     label: "GM View → GM only"             },
  { value: "gm-any",      label: "GM View or Activate → GM only" }
];

/**
 * @param {string} selected
 * @returns {Array<{value:string, label:string, selected:boolean}>}
 */
function buildTriggerOptions(selected) {
  return TRIGGER_OPTIONS.map(o => ({ ...o, selected: o.value === selected }));
}

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class NodeConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static BASE_APPLICATION = ApplicationV2;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "node-config-app",
    classes: ["click-adventure", "node-config"],
    window: { title: "Node Configuration" },
    position: { width: 560, height: "auto" }
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
    /** @type {Array<{id:string, sceneId:string, label:string}>|null} */
    this._pendingLinkedScenes = null;
    /** @type {string|null} ID da linked scene entry atualmente "em uso" (substitui o badge Active das imagens) */
    this._activeLinkedSceneId = null;
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
    const linkedSceneInUse = this._activeLinkedSceneId !== null;
    context.images = workingImages.map((img, i) => ({
      ...img,
      index:          i,
      isActive:       !linkedSceneInUse && i === activeIndex,
      hasMacro:       !!img.macro,
      macroName:      img.macro ? (game.macros.get(img.macro.macroId)?.name ?? "(not found)") : null,
      triggerOptions: img.macro ? buildTriggerOptions(img.macro.trigger) : []
    }));
    context.activeIndex = activeIndex;

    const persistedLinkedScenes = Array.isArray(node.linkedScenes) ? node.linkedScenes : [];
    const workingLinkedScenes = this._pendingLinkedScenes ?? persistedLinkedScenes;
    context.linkedScenes = workingLinkedScenes.map((ls, i) => ({
      ...ls,
      index:          i,
      sceneName:      game.scenes.get(ls.sceneId)?.name ?? "(Scene not found)",
      isActive:       ls.id === this._activeLinkedSceneId,
      hasMacro:       !!ls.macro,
      macroName:      ls.macro ? (game.macros.get(ls.macro.macroId)?.name ?? "(not found)") : null,
      triggerOptions: ls.macro ? buildTriggerOptions(ls.macro.trigger) : []
    }));

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
        this._activeLinkedSceneId = null;   // limpa o estado de linked scene ativa
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

    // Drop zone — accepts Scene drag from the Scene Directory
    const dropzone = html.querySelector(".ca-linked-scenes-dropzone");
    if (dropzone) {
      dropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropzone.classList.add("ca-linked-scenes-dropzone--over");
      });
      dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("ca-linked-scenes-dropzone--over");
      });
      dropzone.addEventListener("drop", (event) => {
        event.preventDefault();
        dropzone.classList.remove("ca-linked-scenes-dropzone--over");

        let data;
        try { data = JSON.parse(event.dataTransfer.getData("text/plain")); }
        catch { return; }

        if (data?.type !== "Scene" || !data?.uuid) return;

        const scene = fromUuidSync(data.uuid);
        if (!scene) return;

        // Prevent duplicates
        const linked = this._getWorkingLinkedScenes();
        if (linked.some(ls => ls.sceneId === scene.id)) {
          ui.notifications.warn("Click Adventure: This scene is already linked to this node.");
          return;
        }

        linked.push({
          id: foundry.utils.randomID(),
          sceneId: scene.id,
          label: scene.name
        });
        this._pendingLinkedScenes = linked;
        this.render({ force: true });
      });
    }

    // Use — view linked scene for GM and all active players on this node
    html.querySelectorAll("[data-action='use-linked-scene']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const idx = parseInt(btn.dataset.index, 10);
        const linked = this._getWorkingLinkedScenes();
        const entry = linked[idx];
        if (!entry) return;

        const scene = game.scenes.get(entry.sceneId);
        if (!scene) {
          ui.notifications.error("Click Adventure: Linked scene not found. It may have been deleted.");
          return;
        }

        // Mark this linked scene as active, clearing image active badge
        this._activeLinkedSceneId = entry.id;
        this.render({ force: true });

        // GM: switch view locally
        await scene.view();

        // Players on this node: send via socket
        for (const user of game.users) {
          if (user.isGM || !user.active) continue;
          const userNodeId = user.getFlag("click-adventure", "currentNodeId");
          if (userNodeId !== this.nodeId) continue;
          await globalThis.ClickAdventure._socket.viewSceneForUser(entry.sceneId, user.id);
        }
      });
    });

    // Remove linked scene
    html.querySelectorAll("[data-action='remove-linked-scene']").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.index, 10);
        const linked = this._getWorkingLinkedScenes();
        linked.splice(idx, 1);
        this._pendingLinkedScenes = linked;
        this.render({ force: true });
      });
    });

    // Edit linked scene label
    html.querySelectorAll(".ca-linked-scene-label-input").forEach(input => {
      input.addEventListener("change", () => {
        const idx = parseInt(input.dataset.index, 10);
        const linked = this._getWorkingLinkedScenes();
        if (linked[idx]) linked[idx].label = input.value.trim() || "Scene";
        this._pendingLinkedScenes = linked;
      });
    });

    // ── Image macro drop zones ────────────────────────────────────────────
    html.querySelectorAll(".ca-image-macro-dropzone").forEach(zone => {
      zone.addEventListener("dragover", e => {
        e.preventDefault();
        zone.classList.add("ca-macro-dropzone--over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("ca-macro-dropzone--over"));
      zone.addEventListener("drop", async e => {
        e.preventDefault();
        zone.classList.remove("ca-macro-dropzone--over");
        const macro = await _resolveMacroFromDrop(e);
        if (!macro) return;
        const idx = parseInt(zone.dataset.index, 10);
        const images = this._getWorkingImages();
        images[idx].macro = { macroId: macro.id, label: macro.name, trigger: "gm-activate" };
        this._pendingImages = images;
        this.render({ force: true });
      });
    });

    html.querySelectorAll("[data-action='remove-image-macro']").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.index, 10);
        const images = this._getWorkingImages();
        if (images[idx]) images[idx].macro = null;
        this._pendingImages = images;
        this.render({ force: true });
      });
    });

    html.querySelectorAll(".ca-image-macro-trigger").forEach(select => {
      select.addEventListener("change", () => {
        const idx = parseInt(select.dataset.index, 10);
        const images = this._getWorkingImages();
        if (images[idx]?.macro) images[idx].macro.trigger = select.value;
        this._pendingImages = images;
      });
    });

    html.querySelectorAll("[data-action='execute-image-macro']").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.index, 10);
        const images = this._getWorkingImages();
        const macroId = images[idx]?.macro?.macroId;
        if (!macroId) return;
        const macro = game.macros.get(macroId);
        if (!macro) { ui.notifications.warn("Click Adventure: Macro not found."); return; }
        macro.execute();
      });
    });

    // ── Linked scene macro drop zones ─────────────────────────────────────
    html.querySelectorAll(".ca-linked-scene-macro-dropzone").forEach(zone => {
      zone.addEventListener("dragover", e => {
        e.preventDefault();
        zone.classList.add("ca-macro-dropzone--over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("ca-macro-dropzone--over"));
      zone.addEventListener("drop", async e => {
        e.preventDefault();
        zone.classList.remove("ca-macro-dropzone--over");
        const macro = await _resolveMacroFromDrop(e);
        if (!macro) return;
        const idx = parseInt(zone.dataset.index, 10);
        const linked = this._getWorkingLinkedScenes();
        linked[idx].macro = { macroId: macro.id, label: macro.name, trigger: "gm-activate" };
        this._pendingLinkedScenes = linked;
        this.render({ force: true });
      });
    });

    html.querySelectorAll("[data-action='remove-linked-scene-macro']").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.index, 10);
        const linked = this._getWorkingLinkedScenes();
        if (linked[idx]) linked[idx].macro = null;
        this._pendingLinkedScenes = linked;
        this.render({ force: true });
      });
    });

    html.querySelectorAll(".ca-linked-scene-macro-trigger").forEach(select => {
      select.addEventListener("change", () => {
        const idx = parseInt(select.dataset.index, 10);
        const linked = this._getWorkingLinkedScenes();
        if (linked[idx]?.macro) linked[idx].macro.trigger = select.value;
        this._pendingLinkedScenes = linked;
      });
    });

    html.querySelectorAll("[data-action='execute-linked-scene-macro']").forEach(btn => {
      btn.addEventListener("click", () => {
        const idx = parseInt(btn.dataset.index, 10);
        const linked = this._getWorkingLinkedScenes();
        const macroId = linked[idx]?.macro?.macroId;
        if (!macroId) return;
        const macro = game.macros.get(macroId);
        if (!macro) { ui.notifications.warn("Click Adventure: Macro not found."); return; }
        macro.execute();
      });
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
   * Returns a mutable copy of the working linked scenes array.
   * @returns {Array<{id:string, sceneId:string, label:string}>}
   */
  _getWorkingLinkedScenes() {
    if (this._pendingLinkedScenes !== null) return [...this._pendingLinkedScenes];
    const { nodes } = getGraphData();
    const node = nodes.find(n => n.id === this.nodeId);
    return Array.isArray(node?.linkedScenes) ? [...node.linkedScenes] : [];
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

    // Navigate GM and all players currently on this node to the node's scene
    if (updatedNode?.sceneId) {
      const nodeSceneId = updatedNode.sceneId;

      // GM: switch view locally
      const gmScene = game.scenes.get(nodeSceneId);
      if (gmScene) await gmScene.view();

      // Players on this node: send via socket
      for (const user of game.users) {
        if (user.isGM || !user.active) continue;
        const userNodeId = user.getFlag("click-adventure", "currentNodeId");
        if (userNodeId !== this.nodeId) continue;
        await globalThis.ClickAdventure._socket.viewSceneForUser(nodeSceneId, user.id);
      }
    }

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
    const linkedScenes = this._getWorkingLinkedScenes();
    const updatedNodes = nodes.map(n => {
      if (n.id !== this.nodeId) return n;
      return { ...n, label, images, activeImageIndex: activeIndex, linkedScenes, imageSrc: undefined };
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
    this._pendingLinkedScenes = null;

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
