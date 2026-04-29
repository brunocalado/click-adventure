/**
 * Main node-graph window for the Click Adventure module.
 * Displays an interactive workspace where the user places scene nodes and draws links between them.
 *
 * Interactions wired in _attachListeners (element-level) and _onFirstRender (document-level):
 *  - Drag nodes to reposition; position is persisted on mouseup.
 *  - Drag from an anchor dot to draw a directed link to another node.
 *  - Click + to add a node; double-click a node to open NodeConfigApp.
 *
 * SVG link layer is redrawn after every mutation via _renderLinks().
 * Lifecycle hook: renderManagerApp
 */

import { NodeConfigApp } from "./node-config-app.js";
import { LinkEditorApp } from "./link-editor-app.js";
import { InstructionsApp } from "./instructions-app.js";
import { SettingsApp } from "./settings-app.js";
import { getNodeActiveImage, isMultiPassage, getEffectiveDirection } from "./node-utils.js";
import { buildSceneData } from "./scene-template.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Fixed node dimensions that match the CSS .ca-node rules. */
const NODE_W = 100;
const NODE_H = 100;

export class ManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static BASE_APPLICATION = ApplicationV2;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "manager-app",
    classes: ["click-adventure", "manager"],
    window: { title: "Click Adventure — Scene Graph", resizable: true },
    position: { width: 900, height: 620 }
  };

  /** @override */
  static PARTS = {
    workspace: {
      template: "modules/click-adventure/templates/manager-app.hbs"
    }
  };

  constructor(options = {}) {
    super(options);
    /**
     * Active drag operation state.
     * @type {{ nodeId: string, nodeEl: HTMLElement, offsetX: number, offsetY: number }|null}
     */
    this._dragState = null;
    /**
     * Active link-draw operation state.
     * @type {{ sourceId: string, sourceAnchor: string, startX: number, startY: number, tempLine: SVGPathElement }|null}
     */
    this._linkState = null;

    // Bound versions kept so document listeners can be removed on close.
    this._docMouseMove = this._onDocMouseMove.bind(this);
    this._docMouseUp = this._onDocMouseUp.bind(this);

    /** @type {InstructionsApp|null} — active instructions popover instance. */
    this._instructionsApp = null;

    /** @type {SettingsApp|null} — active settings popover instance. */
    this._settingsApp = null;

    /**
     * Pending navigation requests from non-GM players.
     * Map<userId, { userId, userName, userColor, fromNodeId, toNodeId, timestamp }>
     * One entry per user — a new request from the same user overwrites the old one.
     * @type {Map<string, object>}
     */
    this._navRequests = new Map();

    /** @type {boolean} — tracks drawer open state across renders. */
    this._drawerOpen = false;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Builds a map of nodeId → occupant display data for all active non-GM users.
   * name priority: linked actor name → user name.
   * @returns {Map<string, Array<{name: string, color: string}>>}
   */
  _buildOccupants() {
    const map = new Map();
    for (const user of game.users) {
      if (user.isGM || !user.active) continue;
      const nodeId = user.getFlag("click-adventure", "currentNodeId");
      if (!nodeId) continue;

      const name  = user.character?.name ?? user.name;
      const color = user.color?.css ?? user.color ?? "#ffffff";

      if (!map.has(nodeId)) map.set(nodeId, []);
      map.get(nodeId).push({ name, color });
    }
    return map;
  }

  /**
   * Approves a pending navigation request: updates the player's flag and emits approval.
   * Triggered by clicking the approve button in the requests drawer.
   * @param {string} userId
   * @param {string} toNodeId
   * @returns {Promise<void>}
   */
  async _approveRequest(userId, toNodeId) {
    const request = this._navRequests.get(userId);
    if (!request) return;

    this._navRequests.delete(userId);

    const user = game.users.get(userId);
    if (user) await user.setFlag("click-adventure", "currentNodeId", toNodeId);

    const { nodes } = this._graphData();
    const targetNode = nodes.find(n => n.id === toNodeId);

    globalThis.ClickAdventure._socket.approveNavRequest(userId, toNodeId, targetNode?.sceneId ?? null);
    this._patchOccupantAvatars();
    this._patchRequestsDrawer();
  }

  /**
   * Rejects a pending navigation request and notifies the player.
   * Triggered by clicking the reject button in the requests drawer.
   * @param {string} userId
   */
  _rejectRequest(userId) {
    this._navRequests.delete(userId);
    globalThis.ClickAdventure._socket.rejectNavRequest(userId);
    this._patchRequestsDrawer();
  }

  /**
   * Patches the requests button badge and drawer content in-place after any queue mutation.
   * Avoids a full re-render — mirrors the pattern used by _patchOccupantAvatars.
   * Safe to call at any time — no-op if the manager is not rendered.
   */
  _patchRequestsDrawer() {
    if (!this.rendered) return;
    const html = this.element;
    const count = this._navRequests.size;

    const btn = html.querySelector(".ca-requests-btn");
    if (btn) {
      btn.textContent = count > 0 ? `Requests (${count})` : "Requests";
      btn.classList.toggle("ca-requests-btn--active", count > 0);
    }

    const drawer = html.querySelector(".ca-requests-drawer");
    if (!drawer) return;

    const { nodes } = this._graphData();
    const getLabel = id => nodes.find(n => n.id === id)?.label || id;
    const requests = [...this._navRequests.values()].sort((a, b) => a.timestamp - b.timestamp);

    const existing = drawer.querySelector(".ca-requests-list, .ca-requests-empty");
    if (!existing) return;

    if (requests.length === 0) {
      existing.outerHTML = `<div class="ca-requests-empty">No pending requests.</div>`;
      return;
    }

    const ul = document.createElement("ul");
    ul.className = "ca-requests-list";

    for (const r of requests) {
      const li = document.createElement("li");
      li.className = "ca-request-item";
      li.dataset.userId = r.userId;
      li.innerHTML = `
        <span class="ca-request-dot" style="background:${r.userColor};"></span>
        <span class="ca-request-info">
          <strong>${r.userName}</strong>
          <span class="ca-request-route">${getLabel(r.fromNodeId)} → ${getLabel(r.toNodeId)}</span>
        </span>
        <button class="ca-request-approve" data-user-id="${r.userId}" data-node-id="${r.toNodeId}" title="Approve">✓</button>
        <button class="ca-request-reject"  data-user-id="${r.userId}" title="Reject">✗</button>
      `;
      li.querySelector(".ca-request-approve").addEventListener("click", () =>
        this._approveRequest(r.userId, r.toNodeId));
      li.querySelector(".ca-request-reject").addEventListener("click", () =>
        this._rejectRequest(r.userId));
      ul.appendChild(li);
    }

    existing.replaceWith(ul);
  }

  /**
   * Updates occupant name label strips in-place without triggering a full re-render.
   * Called when a PLAYER_MOVED socket message is received while the manager is open.
   * Safe to call at any time — no-op if the manager is not rendered.
   */
  _patchOccupantAvatars() {
    if (!this.rendered) return;
    const workspace = this.element?.querySelector(".ca-workspace");
    if (!workspace) return;

    const occupants = this._buildOccupants();

    workspace.querySelectorAll(".ca-node").forEach(nodeEl => {
      const nodeId = nodeEl.dataset.nodeId;
      const list = occupants.get(nodeId) ?? [];

      nodeEl.querySelector(".ca-node-occupants")?.remove();
      if (list.length === 0) return;

      const strip = document.createElement("div");
      strip.className = "ca-node-occupants";

      for (const { name, color } of list) {
        const label = document.createElement("span");
        label.className = "ca-occupant-label";
        label.textContent = name;
        label.title = name;
        label.style.borderColor = color;
        strip.appendChild(label);
      }

      nodeEl.appendChild(strip);
    });
  }

  /**
   * Returns the graph as a plain POJO regardless of whether the setting returns
   * a DataModel instance (normal v14 behaviour) or a raw object (first-run default).
   * @returns {{ sceneId: string, startNodeId: string, nodes: object[], links: object[] }}
   */
  _graphData() {
    const graph = game.settings.get("click-adventure", "graph");
    const raw = typeof graph?.toObject === "function" ? graph.toObject() : (graph ?? {});
    return {
      sceneId: raw.sceneId ?? "",
      startNodeId: raw.startNodeId ?? "",
      nodes: raw.nodes ?? [],
      links: raw.links ?? []
    };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Provides graph nodes and links to the workspace template.
   * Triggered during the ApplicationV2 _prepareContext lifecycle stage.
   *
   * @override
   * @param {object} options
   * @returns {Promise<object>}
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const { nodes, links, startNodeId } = this._graphData();
    const activeNodeId = game.user.getFlag("click-adventure", "currentNodeId") ?? "";
    const occupants = this._buildOccupants();
    context.nodes = nodes.map(n => ({
      ...n,
      imageSrc: getNodeActiveImage(n),
      occupants: occupants.get(n.id) ?? []
    }));
    context.links = links;
    context.startNodeId = startNodeId ?? "";
    context.activeNodeId = activeNodeId;
    context.hasAnyScene = nodes.some(n => n.sceneId && game.scenes.get(n.sceneId));

    const getLabel = id => nodes.find(n => n.id === id)?.label || id;
    context.navigationMode = game.settings.get("click-adventure", "navigationMode");
    context.requestCount   = this._navRequests.size;
    context.drawerOpen     = this._drawerOpen;
    context.requests       = [...this._navRequests.values()]
      .sort((a, b) => a.timestamp - b.timestamp)
      .map(r => ({ ...r, fromLabel: getLabel(r.fromNodeId), toLabel: getLabel(r.toNodeId) }));

    return context;
  }

  /**
   * Attaches document-level mousemove/mouseup exactly once so drag and link-draw
   * work even when the pointer leaves the workspace element.
   * Triggered during the ApplicationV2 _onFirstRender lifecycle stage.
   *
   * @override
   * @param {object} context
   * @param {object} options
   */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    document.addEventListener("mousemove", this._docMouseMove);
    document.addEventListener("mouseup", this._docMouseUp);
  }

  /**
   * Redraws SVG links and wires all element-level listeners after every render.
   * HandlebarsApplicationMixin destroys and recreates part DOM on each render,
   * so there is no risk of duplicate listeners on the new elements.
   * Triggered during the ApplicationV2 _onRender lifecycle stage.
   *
   * @override
   * @param {object} context
   * @param {object} options
   */
  _onRender(context, options) {
    super._onRender(context, options);

    const html = this.element;

    html.querySelectorAll(".ca-node").forEach(nodeEl => {
      nodeEl.addEventListener("mousedown", e => this._onNodeMouseDown(e, nodeEl));
      nodeEl.addEventListener("dblclick", e => this._onNodeDblClick(e, nodeEl));
      nodeEl.addEventListener("contextmenu", e => {
        e.preventDefault();
        e.stopPropagation();
        this._onNodeContextMenu(e, nodeEl.dataset.nodeId);
      });
    });

    html.querySelectorAll(".ca-anchor").forEach(anchor => {
      anchor.addEventListener("mousedown", e => this._onAnchorMouseDown(e, anchor));
    });

    html.querySelectorAll(".ca-view-scene-btn").forEach(btn => {
      btn.addEventListener("mousedown", e => e.stopPropagation()); // prevents accidental drag start
      btn.addEventListener("click", e => {
        e.stopPropagation();
        this._onViewScene(btn.dataset.sceneId, btn.dataset.nodeId);
      });
    });

    html.querySelectorAll(".ca-set-active-btn").forEach(btn => {
      btn.addEventListener("mousedown", e => e.stopPropagation());
      btn.addEventListener("click", e => {
        e.stopPropagation();
        this._onSetActiveNode(btn.dataset.nodeId);
      });
    });

    html.querySelector(".ca-add-node")?.addEventListener("click", () => this._onAddNode());
    html.querySelector(".ca-import-folder")?.addEventListener("click", () => this._onImportFolder());
    html.querySelector(".ca-sync-scenes")?.addEventListener("click", () => this._onSyncScenes());
    html.querySelector(".ca-reset-graph")?.addEventListener("click", () => this._onResetGraph());

    html.querySelector(".ca-nav-mode-select")?.addEventListener("change", async e => {
      await game.settings.set("click-adventure", "navigationMode", e.target.value);
    });

    html.querySelector(".ca-requests-btn")?.addEventListener("click", () => {
      this._drawerOpen = !this._drawerOpen;
      const drawer = html.querySelector(".ca-requests-drawer");
      drawer?.classList.toggle("ca-requests-drawer--open", this._drawerOpen);
    });

    html.querySelectorAll(".ca-request-approve").forEach(btn => {
      btn.addEventListener("click", () => this._approveRequest(btn.dataset.userId, btn.dataset.nodeId));
    });

    html.querySelectorAll(".ca-request-reject").forEach(btn => {
      btn.addEventListener("click", () => this._rejectRequest(btn.dataset.userId));
    });

    const instrBtn = html.querySelector(".ca-instructions-btn");
    if (instrBtn) {
      instrBtn.addEventListener("mouseenter", () => {
        if (!this._instructionsApp?.rendered) {
          const rect = instrBtn.getBoundingClientRect();
          this._instructionsApp = new InstructionsApp(rect, () => {
            this._instructionsApp = null;
          });
          this._instructionsApp.render(true);
        }
      });
      instrBtn.addEventListener("mouseleave", (e) => {
        // Only close if the mouse did not move into the popover itself
        if (this._instructionsApp?.element?.contains(e.relatedTarget)) return;
        this._instructionsApp?.close();
        this._instructionsApp = null;
      });
    }

    const gearBtn = html.querySelector(".ca-settings-btn");
    if (gearBtn) {
      gearBtn.addEventListener("click", () => {
        if (this._settingsApp?.rendered) {
          this._settingsApp.close();
          this._settingsApp = null;
          gearBtn.classList.remove("ca-settings-btn--active");
          return;
        }
        const rect = gearBtn.getBoundingClientRect();
        this._settingsApp = new SettingsApp(rect, () => {
          this._settingsApp = null;
          gearBtn.classList.remove("ca-settings-btn--active");
        });
        gearBtn.classList.add("ca-settings-btn--active");
        this._settingsApp.render(true);
      });
    }

    this._renderLinks();
  }

  /**
   * Removes document-level listeners to prevent leaks after the window is closed.
   * Triggered during the ApplicationV2 _onClose lifecycle stage.
   *
   * @override
   * @param {object} options
   * @returns {Promise<void>}
   */
  async _onClose(options) {
    document.removeEventListener("mousemove", this._docMouseMove);
    document.removeEventListener("mouseup", this._docMouseUp);
    this._dragState = null;
    this._linkState = null;
    this._instructionsApp?.close();
    this._instructionsApp = null;
    this._settingsApp?.close();
    this._settingsApp = null;
    document.querySelector(".ca-context-menu")?.remove();
    await super._onClose(options);
  }

  // ---------------------------------------------------------------------------
  // Interaction handlers
  // ---------------------------------------------------------------------------

  /**
   * Begins a node drag operation.
   * @param {MouseEvent} e
   * @param {HTMLElement} nodeEl
   */
  _onNodeMouseDown(e, nodeEl) {
    // Let anchor mousedown propagate independently
    if (e.target.classList.contains("ca-anchor")) return;
    e.preventDefault();
    e.stopPropagation();

    const nodeRect = nodeEl.getBoundingClientRect();
    this._dragState = {
      nodeId: nodeEl.dataset.nodeId,
      nodeEl,
      offsetX: e.clientX - nodeRect.left,
      offsetY: e.clientY - nodeRect.top
    };
  }

  /**
   * Begins a link-draw operation from the clicked anchor dot.
   * @param {MouseEvent} e
   * @param {HTMLElement} anchor
   */
  _onAnchorMouseDown(e, anchor) {
    e.preventDefault();
    e.stopPropagation();

    const nodeEl = anchor.closest(".ca-node");
    const workspace = this.element.querySelector(".ca-workspace");
    const wsRect = workspace.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();

    const startX = anchorRect.left + anchorRect.width / 2 - wsRect.left;
    const startY = anchorRect.top + anchorRect.height / 2 - wsRect.top;

    const svg = workspace.querySelector(".ca-links-layer");
    const srcAnchor = anchor.dataset.anchor;
    const c = this._bezierOffset(srcAnchor);

    const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tempPath.classList.add("ca-temp-link");
    // Degenerate initial path — updated on every mousemove
    tempPath.setAttribute("d", `M ${startX},${startY} C ${startX + c.dx},${startY + c.dy} ${startX},${startY} ${startX},${startY}`);
    svg.appendChild(tempPath);

    this._linkState = {
      sourceId: nodeEl.dataset.nodeId,
      sourceAnchor: srcAnchor,
      startX,
      startY,
      tempLine: tempPath   // property name kept so _onDocMouseMove and _onDocMouseUp still work
    };
  }

  /**
   * Opens NodeConfigApp for the double-clicked node.
   * @param {MouseEvent} e
   * @param {HTMLElement} nodeEl
   */
  _onNodeDblClick(e, nodeEl) {
    e.preventDefault();
    new NodeConfigApp(nodeEl.dataset.nodeId).render(true);
  }

  /**
   * Sets the GM's current position flag to the clicked node.
   * Only updates the current user's flag — does not affect other players.
   * Triggered by click on .ca-set-active-btn in _onRender.
   *
   * @param {string} nodeId
   * @returns {Promise<void>}
   */
  async _onSetActiveNode(nodeId) {
    if (!nodeId) return;
    await game.user.setFlag("click-adventure", "currentNodeId", nodeId);
    this.render({ force: true });
  }

  /**
   * Switches the GM's canvas view to the scene associated with the clicked node
   * AND sets that node as the active position.
   * Uses scene.view() — only the GM's perspective changes, players are unaffected.
   * Triggered by click on .ca-view-scene-btn in _onRender.
   *
   * @param {string} sceneId
   * @param {string} nodeId
   * @returns {Promise<void>}
   */
  async _onViewScene(sceneId, nodeId) {
    if (!sceneId) return;
    const scene = game.scenes.get(sceneId);
    if (!scene) {
      ui.notifications.warn("Click Adventure: Scene not found. Try running Update Scenes.");
      return;
    }
    await scene.view();
    if (nodeId) await this._onSetActiveNode(nodeId);
  }

  /**
   * Shows a context menu on right-click over a node with options to teleport players.
   * @param {MouseEvent} e
   * @param {string} nodeId
   */
  _onNodeContextMenu(e, nodeId) {
    document.querySelector(".ca-context-menu")?.remove();

    const players = game.users.filter(u => !u.isGM && u.active);
    if (players.length === 0) return;

    const { nodes } = this._graphData();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    const menu = document.createElement("div");
    menu.className = "ca-context-menu";
    menu.style.left = `${e.clientX}px`;
    menu.style.top  = `${e.clientY}px`;

    const header = document.createElement("div");
    header.className = "ca-context-menu-header";
    header.textContent = `Teleport to "${node.label || nodeId}"`;
    menu.appendChild(header);

    menu.appendChild(Object.assign(document.createElement("div"), { className: "ca-context-menu-divider" }));

    for (const user of players) {
      const currentNodeId = user.getFlag("click-adventure", "currentNodeId");
      const isHere = currentNodeId === nodeId;

      const item = document.createElement("div");
      item.className = "ca-context-menu-item" + (isHere ? " ca-context-menu-item--active" : "");

      const dot = document.createElement("span");
      dot.className = "ca-context-menu-dot";
      dot.style.background = user.color?.css ?? user.color ?? "#fff";

      const label = document.createElement("span");
      label.textContent = user.name;

      item.appendChild(dot);
      item.appendChild(label);

      if (isHere) {
        const badge = document.createElement("span");
        badge.className = "ca-context-menu-badge";
        badge.textContent = "here";
        item.appendChild(badge);
      } else {
        item.addEventListener("click", () => {
          menu.remove();
          this._onTeleportPlayer(user, nodeId);
        });
      }

      menu.appendChild(item);
    }

    document.body.appendChild(menu);

    const closeMenu = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener("mousedown", closeMenu);
      }
    };
    // Delay one tick so this very mousedown event doesn't immediately close the menu
    setTimeout(() => document.addEventListener("mousedown", closeMenu), 0);
  }

  /**
   * Teleports a specific player to a target node.
   * Updates their currentNodeId flag and notifies their client via socket.
   * @param {User} user
   * @param {string} nodeId
   * @returns {Promise<void>}
   */
  async _onTeleportPlayer(user, nodeId) {
    const { nodes } = this._graphData();
    const targetNode = nodes.find(n => n.id === nodeId);
    if (!targetNode) return;

    await user.setFlag("click-adventure", "currentNodeId", nodeId);

    if (targetNode.sceneId) {
      await globalThis.ClickAdventure._socket.teleportUser(targetNode.sceneId, user.id);
    } else {
      await globalThis.ClickAdventure._socket.notifyHudRefresh(user.id);
    }

    this._patchOccupantAvatars();
  }

  /**
   * Updates drag position or temp link line as the pointer moves.
   * Document-level listener — fires even when pointer is outside the workspace.
   * @param {MouseEvent} e
   */
  _onDocMouseMove(e) {
    if (!this._dragState && !this._linkState) return;

    const workspace = this.element?.querySelector(".ca-workspace");
    if (!workspace) return;
    const wsRect = workspace.getBoundingClientRect();

    if (this._dragState) {
      const { nodeEl, offsetX, offsetY } = this._dragState;
      nodeEl.style.left = `${e.clientX - wsRect.left - offsetX}px`;
      nodeEl.style.top  = `${e.clientY - wsRect.top  - offsetY}px`;
      this._renderLinks();
    }

    if (this._linkState) {
      const { tempLine: tempPath, startX, startY, sourceAnchor } = this._linkState;
      const mx = e.clientX - wsRect.left;
      const my = e.clientY - wsRect.top;
      const c1 = this._bezierOffset(sourceAnchor);
      tempPath.setAttribute("d",
        `M ${startX},${startY} C ${startX + c1.dx},${startY + c1.dy} ${mx},${my} ${mx},${my}`
      );
    }
  }

  /**
   * Finalises drag (saves position) or link draw (saves link or discards).
   * Document-level listener — fires even when pointer is outside the workspace.
   * @param {MouseEvent} e
   * @returns {Promise<void>}
   */
  async _onDocMouseUp(e) {
    if (this._dragState) {
      const { nodeId, nodeEl, offsetX, offsetY } = this._dragState;
      this._dragState = null;

      const workspace = this.element?.querySelector(".ca-workspace");
      const wsRect = workspace?.getBoundingClientRect();
      if (wsRect) {
        const x = Math.round(e.clientX - wsRect.left - offsetX);
        const y = Math.round(e.clientY - wsRect.top  - offsetY);
        await this._saveNodePosition(nodeId, x, y);
      }
    }

    if (this._linkState) {
      const { sourceId, sourceAnchor, tempLine } = this._linkState;
      this._linkState = null;
      tempLine.remove();

      const targetEl = e.target.closest?.(".ca-node");
      const targetId = targetEl?.dataset?.nodeId;
      if (targetId && targetId !== sourceId) {
        const targetAnchorEl = e.target.closest?.(".ca-anchor");
        const targetAnchor = targetAnchorEl?.dataset?.anchor ?? this._nearestAnchor(e, targetEl);
        await this._saveLink(sourceId, sourceAnchor, targetId, targetAnchor);
      }
    }
  }

  /**
   * Creates a new node at the workspace center and saves it.
   * @returns {Promise<void>}
   */
  async _onAddNode() {
    const { sceneId, startNodeId, nodes, links } = this._graphData();
    const workspace = this.element?.querySelector(".ca-workspace");
    const w = workspace?.clientWidth  ?? 600;
    const h = workspace?.clientHeight ?? 400;

    const newNode = {
      id: foundry.utils.randomID(),
      label: "Scene",
      images: [],
      activeImageIndex: 0,
      sceneId: null,
      x: Math.round((w - NODE_W) / 2),
      y: Math.round((h - NODE_H) / 2)
    };

    // First node added automatically becomes the start node
    const newStartNodeId = nodes.length === 0 ? newNode.id : startNodeId;
    await game.settings.set("click-adventure", "graph", {
      sceneId, startNodeId: newStartNodeId, nodes: [...nodes, newNode], links
    });
    this.render({ force: true });
  }

  /**
   * Opens a FilePicker in folder-selection mode.
   * When the user confirms a folder, reads all image files in it and creates one
   * new node per image not already present in the graph (duplicate detection via images[0].src).
   *
   * Triggered by click on .ca-import-folder in _onRender.
   * @returns {void}
   */
  _onImportFolder() {
    const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"]);

    // Resolve the active FilePicker implementation (handles The Forge and other hosts)
    const FilePickerClass = foundry.applications.apps.FilePicker.implementation
      ?? foundry.applications.apps.FilePicker;

    const picker = new FilePickerClass({
      type: "folder",
      current: "",
      callback: async (folderPath) => {
        let browseResult;
        try {
          browseResult = await foundry.applications.apps.FilePicker.browse("data", folderPath);
        } catch (err) {
          ui.notifications.error(`Click Adventure: Could not read folder "${folderPath}". ${err.message}`);
          return;
        }

        const imageFiles = (browseResult.files ?? []).filter(filePath => {
          const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
          return IMAGE_EXTENSIONS.has(ext);
        });

        if (imageFiles.length === 0) {
          ui.notifications.warn("Click Adventure: No image files found in the selected folder.");
          return;
        }

        const { sceneId, startNodeId, nodes, links } = this._graphData();
        const existingPaths = new Set(nodes.map(n => n.images?.[0]?.src).filter(Boolean));

        const workspace = this.element?.querySelector(".ca-workspace");
        const wsWidth  = workspace?.clientWidth  ?? 800;
        const COLS     = Math.max(1, Math.floor((wsWidth - 40) / (NODE_W + 20)));
        const offsetX  = nodes.length;

        const newNodes = [];
        for (let i = 0; i < imageFiles.length; i++) {
          const filePath = imageFiles[i];
          if (existingPaths.has(filePath)) continue;

          const bare  = filePath.split("/").pop().replace(/\.[^.]+$/, "");
          const label = this._filenameToLabel(bare);

          const totalIndex = offsetX + newNodes.length;
          const col = totalIndex % COLS;
          const row = Math.floor(totalIndex / COLS);
          const x   = 20 + col * (NODE_W + 20);
          const y   = 20 + row * (NODE_H + 40);

          newNodes.push({
            id: foundry.utils.randomID(),
            label,
            images: [{ src: filePath }],
            activeImageIndex: 0,
            sceneId: null,
            x,
            y
          });
        }

        if (newNodes.length === 0) {
          ui.notifications.info("Click Adventure: All images in this folder are already imported.");
          return;
        }

        const newStartNodeId = nodes.length === 0 ? newNodes[0].id : startNodeId;
        await game.settings.set("click-adventure", "graph", {
          sceneId,
          startNodeId: newStartNodeId,
          nodes: [...nodes, ...newNodes],
          links
        });

        this.render({ force: true });
        ui.notifications.info(`Click Adventure: Imported ${newNodes.length} node(s).`);
      }
    });

    picker.render(true);
  }

  /**
   * Converts a raw filename (without extension) to a human-readable label.
   * Hyphens and underscores become spaces; each word is title-cased except
   * pure-numeric tokens (e.g. "01") which are left as-is.
   *
   * @param {string} filename — bare filename without path or extension
   * @returns {string}
   */
  _filenameToLabel(filename) {
    return filename
      .replace(/[-_]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim()
      .split(" ")
      .map(word => {
        if (/^\d+$/.test(word)) return word;
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(" ");
  }

  // ---------------------------------------------------------------------------
  // Persistence helpers
  // ---------------------------------------------------------------------------

  /**
   * Persists the new x/y of a node after a drag.
   * @param {string} nodeId
   * @param {number} x
   * @param {number} y
   * @returns {Promise<void>}
   */
  async _saveNodePosition(nodeId, x, y) {
    const { sceneId, startNodeId, nodes: rawNodes, links } = this._graphData();
    const nodes = rawNodes.map(n => n.id === nodeId ? { ...n, x, y } : n);
    await game.settings.set("click-adventure", "graph", { sceneId, startNodeId, nodes, links });
    this._renderLinks();
  }

  /**
   * Persists a new directed link between two anchor points, skipping duplicates.
   * @param {string} sourceId
   * @param {string} sourceAnchor
   * @param {string} targetId
   * @param {string} targetAnchor
   * @returns {Promise<void>}
   */
  async _saveLink(sourceId, sourceAnchor, targetId, targetAnchor) {
    const { sceneId, startNodeId, nodes, links } = this._graphData();
    const duplicate = links.some(l =>
      l.sourceId === sourceId && l.sourceAnchor === sourceAnchor &&
      l.targetId === targetId && l.targetAnchor === targetAnchor
    );
    if (duplicate) return;

    await game.settings.set("click-adventure", "graph", {
      sceneId, startNodeId, nodes,
      links: [...links, { sourceId, sourceAnchor, targetId, targetAnchor, passages: [{ label: "", direction: "both" }] }]
    });
    this.render({ force: true });
  }

  /**
   * Returns the anchor side closest to the pointer — used when mouseup lands on the
   * node body rather than an anchor dot.
   * @param {MouseEvent} e
   * @param {HTMLElement} nodeEl
   * @returns {string} "top" | "right" | "bottom" | "left"
   */
  _nearestAnchor(e, nodeEl) {
    const r = nodeEl.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    return Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? "right" : "left")
      : (dy > 0 ? "bottom" : "top");
  }

  // ---------------------------------------------------------------------------
  // SVG rendering
  // ---------------------------------------------------------------------------

  /**
   * Returns the cubic Bézier control point offset for a given anchor side.
   * The control point is displaced outward from the anchor in its natural exit direction,
   * creating a curve that visually "leaves" the node perpendicular to its edge.
   *
   * @param {string} side     — "top" | "right" | "bottom" | "left"
   * @param {number} tension  — pixel distance of the control point from the anchor (default 80)
   * @returns {{ dx: number, dy: number }}
   */
  _bezierOffset(side, tension = 80) {
    switch (side) {
      case "top":    return { dx:  0,       dy: -tension };
      case "right":  return { dx:  tension, dy:  0       };
      case "bottom": return { dx:  0,       dy:  tension };
      case "left":   return { dx: -tension, dy:  0       };
      default:       return { dx:  tension, dy:  0       };
    }
  }

  /**
   * Redraws all persistent SVG link lines from the current setting state.
   * Lines now connect named anchor dots instead of node centers.
   * Called from _onRender and after every graph mutation.
   */
  _renderLinks() {
    const workspace = this.element?.querySelector(".ca-workspace");
    if (!workspace) return;
    const svg = workspace.querySelector(".ca-links-layer");
    if (!svg) return;

    const { links } = this._graphData();

    // Remove only permanent links and direction indicators; leave the transient .ca-temp-link intact
    svg.querySelectorAll(".ca-link, .ca-link-hit, .ca-link-direction, .ca-link-direction-arrow").forEach(el => el.remove());

    const wsRect = workspace.getBoundingClientRect();

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const srcEl = workspace.querySelector(`[data-node-id="${link.sourceId}"]`);
      const tgtEl = workspace.querySelector(`[data-node-id="${link.targetId}"]`);
      if (!srcEl || !tgtEl) continue;

      const sourceAnchor = link.sourceAnchor ?? "right";
      const targetAnchor = link.targetAnchor ?? "left";
      const p1 = this._anchorPoint(srcEl, sourceAnchor, wsRect);
      const p2 = this._anchorPoint(tgtEl, targetAnchor, wsRect);
      const c1 = this._bezierOffset(sourceAnchor);
      const c2 = this._bezierOffset(targetAnchor);
      // Cubic Bézier: M start C cp1 cp2 end
      const d = `M ${p1.x},${p1.y} C ${p1.x + c1.dx},${p1.y + c1.dy} ${p2.x + c2.dx},${p2.y + c2.dy} ${p2.x},${p2.y}`;

      // Visible path — pointer events disabled so the hit area path on top handles interactions
      const direction = getEffectiveDirection(link);
      const multi = isMultiPassage(link);
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.classList.add("ca-link");
      path.setAttribute("d", d);
      path.dataset.direction = direction;
      if (multi) path.dataset.multi = "true";
      path.style.pointerEvents = "none";
      svg.appendChild(path);

      // Invisible wide hit-area path — easy right-click target, toggles hover state on the visible path
      const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hitPath.classList.add("ca-link-hit");
      hitPath.setAttribute("d", d);
      hitPath.dataset.linkIndex = String(i);
      hitPath.style.pointerEvents = "visibleStroke";
      hitPath.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        // Shift+click or multi-passage link → open editor; plain click on single-passage → cycle direction
        if (e.shiftKey || multi) {
          new LinkEditorApp(i).render(true);
        } else {
          this._onCycleLink(i);
        }
      });
      hitPath.addEventListener("contextmenu", e => {
        e.preventDefault();
        e.stopPropagation();
        this._onDeleteLink(e, hitPath);
      });
      hitPath.addEventListener("mouseenter", () => path.classList.add("ca-link--hover"));
      hitPath.addEventListener("mouseleave", () => path.classList.remove("ca-link--hover"));
      svg.appendChild(hitPath);

      // Midpoint indicator — ⊕ for multi-passage, text for both/blocked, arrow for forward/backward
      const mid = this._pathMidpoint(p1, c1, p2, c2);

      if (multi) {
        const indicator = document.createElementNS("http://www.w3.org/2000/svg", "text");
        indicator.classList.add("ca-link-direction");
        indicator.setAttribute("x", mid.x);
        indicator.setAttribute("y", mid.y);
        indicator.setAttribute("text-anchor", "middle");
        indicator.setAttribute("dominant-baseline", "central");
        indicator.dataset.direction = "multi";
        indicator.style.pointerEvents = "none";
        indicator.textContent = "⊕";
        svg.appendChild(indicator);
      } else if (direction === "both" || direction === "blocked") {
        const indicator = document.createElementNS("http://www.w3.org/2000/svg", "text");
        indicator.classList.add("ca-link-direction");
        indicator.setAttribute("x", mid.x);
        indicator.setAttribute("y", mid.y);
        indicator.setAttribute("text-anchor", "middle");
        indicator.setAttribute("dominant-baseline", "central");
        indicator.dataset.direction = direction;
        indicator.style.pointerEvents = "none";
        indicator.textContent = direction === "both" ? "⟷" : "✕";
        svg.appendChild(indicator);
      } else {
        // Arrowhead aligned with the curve tangent at t=0.5
        const angle = this._pathTangentAngle(p1, c1, p2, c2);
        const arrowAngle = direction === "forward" ? angle : angle + 180;
        const arrow = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        arrow.classList.add("ca-link-direction-arrow");
        arrow.dataset.direction = direction;
        // Tip at (8,0), base corners at (-6,-5) and (-6,5) — points right by default
        arrow.setAttribute("points", "8,0 -6,-5 -6,5");
        arrow.setAttribute("transform", `translate(${mid.x}, ${mid.y}) rotate(${arrowAngle})`);
        arrow.style.pointerEvents = "none";
        svg.appendChild(arrow);
      }
    }
  }

  /**
   * Returns the workspace-relative center of a named anchor dot on a node.
   * Reads live DOM position so it stays accurate during drags.
   * @param {HTMLElement} nodeEl — the .ca-node element
   * @param {string} side       — "top" | "right" | "bottom" | "left"
   * @param {DOMRect} wsRect    — workspace getBoundingClientRect()
   * @returns {{ x: number, y: number }}
   */
  _anchorPoint(nodeEl, side, wsRect) {
    const dot = nodeEl.querySelector(`.ca-anchor[data-anchor="${side}"]`);
    if (dot) {
      const r = dot.getBoundingClientRect();
      return {
        x: r.left + r.width  / 2 - wsRect.left,
        y: r.top  + r.height / 2 - wsRect.top
      };
    }
    // Fallback when the anchor dot is not in the DOM
    const nx = parseFloat(nodeEl.style.left) || 0;
    const ny = parseFloat(nodeEl.style.top)  || 0;
    const offsets = {
      top:    { x: NODE_W / 2, y: 0 },
      right:  { x: NODE_W,     y: NODE_H / 2 },
      bottom: { x: NODE_W / 2, y: NODE_H },
      left:   { x: 0,          y: NODE_H / 2 }
    };
    return { x: nx + offsets[side].x, y: ny + offsets[side].y };
  }

  /**
   * Returns the approximate midpoint of a cubic Bézier curve (t=0.5) using De Casteljau.
   * @param {{ x: number, y: number }} p1
   * @param {{ dx: number, dy: number }} c1
   * @param {{ x: number, y: number }} p2
   * @param {{ dx: number, dy: number }} c2
   * @returns {{ x: number, y: number }}
   */
  _pathMidpoint(p1, c1, p2, c2) {
    const cp1 = { x: p1.x + c1.dx, y: p1.y + c1.dy };
    const cp2 = { x: p2.x + c2.dx, y: p2.y + c2.dy };
    const t = 0.5;
    const x = Math.pow(1-t,3)*p1.x + 3*Math.pow(1-t,2)*t*cp1.x + 3*(1-t)*t*t*cp2.x + Math.pow(t,3)*p2.x;
    const y = Math.pow(1-t,3)*p1.y + 3*Math.pow(1-t,2)*t*cp1.y + 3*(1-t)*t*t*cp2.y + Math.pow(t,3)*p2.y;
    return { x, y };
  }

  /**
   * Returns the tangent angle (degrees) of a cubic Bézier at t=0.5.
   * Used to rotate the directional arrow so it aligns with the curve.
   * @param {{ x: number, y: number }} p1
   * @param {{ dx: number, dy: number }} c1
   * @param {{ x: number, y: number }} p2
   * @param {{ dx: number, dy: number }} c2
   * @returns {number}
   */
  _pathTangentAngle(p1, c1, p2, c2) {
    const cp1 = { x: p1.x + c1.dx, y: p1.y + c1.dy };
    const cp2 = { x: p2.x + c2.dx, y: p2.y + c2.dy };
    const t = 0.5;
    const dx = 3*Math.pow(1-t,2)*(cp1.x-p1.x) + 6*(1-t)*t*(cp2.x-cp1.x) + 3*t*t*(p2.x-cp2.x);
    const dy = 3*Math.pow(1-t,2)*(cp1.y-p1.y) + 6*(1-t)*t*(cp2.y-cp1.y) + 3*t*t*(p2.y-cp2.y);
    return Math.atan2(dy, dx) * (180 / Math.PI);
  }

  /**
   * Cycles a link's direction through: both → forward → backward → blocked → both.
   * Triggered by left-click on a .ca-link-hit element during _renderLinks.
   * @param {number} linkIndex
   * @returns {Promise<void>}
   */
  async _onCycleLink(linkIndex) {
    const { sceneId, startNodeId, nodes, links } = this._graphData();
    const cycle = { both: "forward", forward: "backward", backward: "blocked", blocked: "both" };
    const updatedLinks = links.map((l, i) => {
      if (i !== linkIndex) return l;
      // Multi-passage links are edited via LinkEditorApp — cycling is a no-op here
      if (isMultiPassage(l)) return l;
      const currentDir = l.passages?.[0]?.direction ?? l.direction ?? "both";
      const newDir = cycle[currentDir];
      const updatedPassages = l.passages
        ? [{ ...l.passages[0], direction: newDir }]
        : [{ label: "", direction: newDir }];
      return { ...l, passages: updatedPassages };
    });
    await game.settings.set("click-adventure", "graph", { sceneId, startNodeId, nodes, links: updatedLinks });
    this._renderLinks();

    // Notify HUD immediately so destination list reflects the new link state
    const hud = globalThis.ClickAdventure._hud;
    if (hud?.rendered) hud.render({ force: true });
  }

  /**
   * Deletes a link after a right-click contextmenu event on its SVG line.
   * Uses a native Foundry DialogV2 confirmation to avoid accidental deletion.
   * Triggered by contextmenu on a .ca-link element during _renderLinks.
   * @param {MouseEvent} e
   * @param {SVGLineElement} lineEl
   * @returns {Promise<void>}
   */
  async _onDeleteLink(e, lineEl) {
    console.log("[ClickAdventure] _onDeleteLink fired, index:", lineEl.dataset.linkIndex);
    const linkIndex = parseInt(lineEl.dataset.linkIndex, 10);

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete Link" },
      content: "<p>Remove this connection?</p>",
      rejectClose: false
    });
    if (!confirmed) return;

    // Re-fetch after dialog closes — user may have taken time to confirm
    const freshGraph = this._graphData();
    const filtered = freshGraph.links.filter((_, idx) => idx !== linkIndex);
    await game.settings.set("click-adventure", "graph", {
      sceneId: freshGraph.sceneId,
      startNodeId: freshGraph.startNodeId,
      nodes: freshGraph.nodes,
      links: filtered
    });
    this.render({ force: true });
  }

  /**
   * Finds or creates the "Click Adventure" Scene folder used to group all node scenes.
   * @returns {Promise<Folder>}
   */
  async _getOrCreateFolder() {
    let folder = game.folders.find(
      f => f.name === "Click Adventure" && f.type === "Scene"
    );
    if (!folder) {
      folder = await Folder.create({ name: "Click Adventure", type: "Scene", sorting: "a" });
    }
    return folder;
  }

  /**
   * Creates a Foundry Scene for a single node and returns the new scene's id.
   * The scene gets a 1920×1080 canvas; if the node has an active image, a managed
   * background tile is created immediately.
   *
   * @param {object} node
   * @param {string} folderId
   * @returns {Promise<string>} the new scene id
   */
  async _createSceneForNode(node, folderId) {
    const rawImage = getNodeActiveImage(node);
    const activeImage = rawImage || null;

    const sceneData = buildSceneData(node.label || "Scene");
    sceneData.folder = folderId;
    sceneData.navigation = false;

    const rawTransition = game.settings.get("click-adventure", "transitionType");
    sceneData.transition.type = rawTransition === "null" ? null : rawTransition;

    // Rebuild tiles[0] as a new object to avoid mutating the shared template reference
    const baseTile = sceneData.tiles[0];
    sceneData.tiles = [
      {
        ...baseTile,
        texture: {
          ...baseTile.texture,
          src: activeImage ?? baseTile.texture.src
        },
        locked: true,
        flags: { "click-adventure": { managed: true } }
      }
    ];

    const scene = await Scene.create(sceneData);
    return scene.id;
  }

  /**
   * Syncs all node scenes: deletes orphaned scenes, creates missing scenes, and
   * updates scene names and background tiles to match current node data.
   *
   * Triggered by the "Sync Scenes" toolbar button.
   * @returns {Promise<void>}
   */
  async _onSyncScenes() {
    const { sceneId, startNodeId, nodes, links } = this._graphData();
    const folder = await this._getOrCreateFolder();
    let updated = 0;

    // Remove scenes in the folder that no longer correspond to any node
    const validSceneIds = new Set(nodes.map(n => n.sceneId).filter(Boolean));
    const folderScenes = game.scenes.filter(s => s.folder?.id === folder.id);
    for (const scene of folderScenes) {
      if (!validSceneIds.has(scene.id)) await scene.delete();
    }

    const updatedNodes = [...nodes];
    for (let i = 0; i < updatedNodes.length; i++) {
      const node = updatedNodes[i];

      // Create scene if missing or stale
      if (!node.sceneId || !game.scenes.get(node.sceneId)) {
        const newSceneId = await this._createSceneForNode(node, folder.id);
        updatedNodes[i] = { ...updatedNodes[i], sceneId: newSceneId };
        updated++;
        continue;
      }

      const scene = game.scenes.get(node.sceneId);

      const rawTransitionSync = game.settings.get("click-adventure", "transitionType");
      const transitionTypeSync = rawTransitionSync === "null" ? null : rawTransitionSync;
      const sceneUpdate = { "transition.type": transitionTypeSync };
      if (scene.name !== node.label) sceneUpdate.name = node.label;
      await scene.update(sceneUpdate);

      const activeImage = node.images?.[node.activeImageIndex ?? 0]?.src
                       ?? node.images?.[0]?.src
                       ?? null;

      const tile = scene.tiles.find(t => t.getFlag("click-adventure", "managed"));

      if (activeImage) {
        if (!tile) {
          const tileTemplate = buildSceneData("").tiles[0];
          await scene.createEmbeddedDocuments("Tile", [{
            ...tileTemplate,
            texture: { ...tileTemplate.texture, src: activeImage },
            locked: true,
            flags: { "click-adventure": { managed: true } }
          }]);
        } else if (tile.texture.src !== activeImage) {
          await tile.update({ texture: { src: activeImage } });
        }
      } else if (tile) {
        await tile.delete();
      }

      updated++;
    }

    await game.settings.set("click-adventure", "graph", {
      sceneId, startNodeId, nodes: updatedNodes, links
    });
    this.render({ force: true });
    ui.notifications.info(`Click Adventure: ${updated} scene(s) synced.`);
  }

  /**
   * Resets the entire graph — clears all nodes, links, and deletes all scenes
   * in the "Click Adventure" folder. Requires explicit confirmation.
   * Triggered by the "Reset" toolbar button.
   * @returns {Promise<void>}
   */
  async _onResetGraph() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Reset Graph" },
      content: "<p>This will delete <strong>all nodes, links and their Foundry Scenes</strong>. This cannot be undone.</p><p>Are you sure?</p>",
      rejectClose: false
    });
    if (!confirmed) return;

    // Delete all scenes in the "Click Adventure" folder
    const folder = game.folders.find(
      f => f.name === "Click Adventure" && f.type === "Scene"
    );
    if (folder) {
      const folderScenes = game.scenes.filter(s => s.folder?.id === folder.id);
      for (const scene of folderScenes) await scene.delete();
      await folder.delete();
    }

    // Clear all users' position flags in a single batch — sequential await loops are prohibited
    const userUpdates = game.users.map(u => ({
      _id: u.id,
      flags: { "click-adventure": { "currentNodeId": null } }
    }));
    await User.updateDocuments(userUpdates);

    await game.settings.set("click-adventure", "graph", {
      sceneId: "",
      startNodeId: "",
      nodes: [],
      links: []
    });

    // Close HUD if open — it no longer has a valid state
    if (globalThis.ClickAdventure._hud?.rendered) {
      globalThis.ClickAdventure._hud.close();
    }

    this.render({ force: true });
    ui.notifications.info("Click Adventure: graph reset.");
  }
}
