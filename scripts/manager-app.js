/**
 * Main node-graph window for the Click Adventure module.
 * Displays an interactive workspace where the user places scene nodes and draws links between them.
 *
 * This file is a thin shell: it handles ApplicationV2 lifecycle, wires event listeners,
 * and delegates all domain logic to four extracted modules:
 *  - manager-graph.js        — SVG link rendering, Bézier geometry
 *  - manager-interaction.js  — Node drag, link-draw, pan
 *  - manager-players.js      — Occupant display, teleport, navigation requests
 *  - manager-scene-ops.js    — Node creation, folder import, scene sync, reset
 *
 * SVG link layer is redrawn after every mutation via renderLinks().
 * Lifecycle hook: renderManagerApp
 */

import { InstructionsApp } from "./instructions-app.js";
import { SettingsApp } from "./settings-app.js";
import { getNodeActiveImage, getGraphData } from "./node-utils.js";

import { renderLinks } from "./manager-graph.js";
import {
  CANVAS_SIZE,
  onNodeMouseDown, onAnchorMouseDown, onNodeDblClick,
  onDocMouseMove, onDocMouseUp
} from "./manager-interaction.js";
import {
  buildOccupants, patchOccupantAvatars, patchRequestsDrawer,
  approveRequest, onApproveAll, rejectRequest,
  onSetActiveNode, onViewScene, onNodeContextMenu, onSendToStart
} from "./manager-players.js";
import {
  onAddNode, onImportFolder, onSyncScenes, onResetGraph
} from "./manager-scene-ops.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

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
    this._docMouseMove = (e) => onDocMouseMove(this, e);
    this._docMouseUp   = (e) => onDocMouseUp(this, e);

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

    /**
     * Current pan offset of the canvas.
     * @type {{ x: number, y: number }}
     */
    // Restore pan from client setting so position survives close/reopen
    const savedPan = game.settings.get("click-adventure", "managerPan");
    this._pan = { x: savedPan?.x ?? 0, y: savedPan?.y ?? 0 };

    /**
     * Active pan drag state.
     * @type {{ startX: number, startY: number, originX: number, originY: number }|null}
     */
    this._panState = null;
  }

  // ---------------------------------------------------------------------------
  // Public API — delegates to extracted modules
  // ---------------------------------------------------------------------------

  /** @see buildOccupants in manager-players.js */
  _buildOccupants() { return buildOccupants(); }

  /** @see patchOccupantAvatars in manager-players.js */
  _patchOccupantAvatars() { patchOccupantAvatars(this); }

  /** @see patchRequestsDrawer in manager-players.js */
  _patchRequestsDrawer() { patchRequestsDrawer(this); }

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
    const { nodes, links, startNodeId } = getGraphData();
    const activeNodeId = game.user.getFlag("click-adventure", "currentNodeId") ?? "";
    const occupants = buildOccupants();
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
      nodeEl.addEventListener("mousedown", e => onNodeMouseDown(this, e, nodeEl));
      nodeEl.addEventListener("dblclick", e => onNodeDblClick(this, e, nodeEl));
      nodeEl.addEventListener("contextmenu", e => {
        e.preventDefault();
        e.stopPropagation();
        onNodeContextMenu(this, e, nodeEl.dataset.nodeId);
      });
    });

    html.querySelectorAll(".ca-anchor").forEach(anchor => {
      anchor.addEventListener("mousedown", e => onAnchorMouseDown(this, e, anchor));
    });

    html.querySelectorAll(".ca-view-scene-btn").forEach(btn => {
      btn.addEventListener("mousedown", e => e.stopPropagation()); // prevents accidental drag start
      btn.addEventListener("click", e => {
        e.stopPropagation();
        onViewScene(this, btn.dataset.sceneId, btn.dataset.nodeId);
      });
    });

    html.querySelectorAll(".ca-set-active-btn").forEach(btn => {
      btn.addEventListener("mousedown", e => e.stopPropagation());
      btn.addEventListener("click", e => {
        e.stopPropagation();
        onSetActiveNode(this, btn.dataset.nodeId);
      });
    });

    html.querySelector(".ca-add-node")?.addEventListener("click", () => onAddNode(this));
    html.querySelector(".ca-import-folder")?.addEventListener("click", () => onImportFolder(this));
    html.querySelector(".ca-sync-scenes")?.addEventListener("click", () => onSyncScenes(this));
    html.querySelector(".ca-send-to-start")?.addEventListener("click", () => onSendToStart(this));
    html.querySelector(".ca-reset-graph")?.addEventListener("click", () => onResetGraph(this));

    html.querySelectorAll(".ca-nav-mode-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const mode = btn.dataset.mode;
        await game.settings.set("click-adventure", "navigationMode", mode);
        html.querySelectorAll(".ca-nav-mode-btn").forEach(b => {
          b.classList.toggle("ca-nav-mode-btn--active", b.dataset.mode === mode);
        });
      });
    });

    html.querySelector(".ca-requests-btn")?.addEventListener("click", () => {
      this._drawerOpen = !this._drawerOpen;
      const drawer = html.querySelector(".ca-requests-drawer");
      drawer?.classList.toggle("ca-requests-drawer--open", this._drawerOpen);
    });

    html.querySelector(".ca-approve-all-btn")?.addEventListener("click", () => onApproveAll(this));

    html.querySelectorAll(".ca-request-approve").forEach(btn => {
      btn.addEventListener("click", () => approveRequest(this, btn.dataset.userId, btn.dataset.nodeId));
    });

    html.querySelectorAll(".ca-request-reject").forEach(btn => {
      btn.addEventListener("click", () => rejectRequest(this, btn.dataset.userId));
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

    // Apply saved pan offset to canvas
    const canvas = html.querySelector(".ca-canvas");
    if (canvas) {
      canvas.style.transform = `translate(${this._pan.x}px, ${this._pan.y}px)`;
    }

    renderLinks(this);

    // Pan: mousedown on workspace background (not on a node or button)
    const workspace = html.querySelector(".ca-workspace");
    if (workspace) {
      workspace.addEventListener("mousedown", e => {
        if (e.target !== workspace && !e.target.classList.contains("ca-canvas")) return;
        if (e.button !== 2) return;  // pan only on right-click
        e.preventDefault();
        this._panState = {
          startX: e.clientX,
          startY: e.clientY,
          originX: this._pan.x,
          originY: this._pan.y
        };
      });

      // Suppress the native browser context menu on the canvas background so
      // right-drag pan works cleanly. Node contextmenu listeners call
      // stopPropagation, so they are unaffected.
      workspace.addEventListener("contextmenu", e => {
        if (e.target === workspace || e.target.classList.contains("ca-canvas")) {
          e.preventDefault();
        }
      });
    }
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
}
