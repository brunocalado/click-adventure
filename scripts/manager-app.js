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

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Fixed node dimensions that match the CSS .ca-node rules. */
const NODE_W = 120;
const NODE_H = 100;

export class ManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static BASE_APPLICATION = ApplicationV2;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "manager-app",
    classes: ["click-adventure", "manager"],
    window: { title: "Click Adventure — Scene Graph" },
    position: { width: 900, height: 620, resizable: true }
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
     * @type {{ sourceId: string, startX: number, startY: number, tempLine: SVGLineElement }|null}
     */
    this._linkState = null;

    // Bound versions kept so document listeners can be removed on close.
    this._docMouseMove = this._onDocMouseMove.bind(this);
    this._docMouseUp = this._onDocMouseUp.bind(this);
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
    const graph = game.settings.get("click-adventure", "graph");
    context.nodes = graph.nodes;
    context.links = graph.links;
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
   * Redraws SVG links after every render (new DOM means stale line elements).
   * Triggered during the ApplicationV2 _onRender lifecycle stage.
   *
   * @override
   * @param {object} context
   * @param {object} options
   */
  _onRender(context, options) {
    super._onRender(context, options);
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
    await super._onClose(options);
  }

  /**
   * Attaches element-level event listeners after each render.
   * Called automatically by the ApplicationV2 framework after each render cycle.
   *
   * @override
   */
  _attachListeners() {
    super._attachListeners();
    const html = this.element;

    html.querySelectorAll(".ca-node").forEach(nodeEl => {
      nodeEl.addEventListener("mousedown", e => this._onNodeMouseDown(e, nodeEl));
      nodeEl.addEventListener("dblclick", e => this._onNodeDblClick(e, nodeEl));
    });

    html.querySelectorAll(".ca-anchor").forEach(anchor => {
      anchor.addEventListener("mousedown", e => this._onAnchorMouseDown(e, anchor));
    });

    html.querySelector(".ca-add-node")?.addEventListener("click", () => this._onAddNode());
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
    const tempLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    tempLine.classList.add("ca-temp-link");
    tempLine.setAttribute("x1", startX);
    tempLine.setAttribute("y1", startY);
    tempLine.setAttribute("x2", startX);
    tempLine.setAttribute("y2", startY);
    svg.appendChild(tempLine);

    this._linkState = { sourceId: nodeEl.dataset.nodeId, tempLine };
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
      const { tempLine } = this._linkState;
      tempLine.setAttribute("x2", e.clientX - wsRect.left);
      tempLine.setAttribute("y2", e.clientY - wsRect.top);
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
      const { sourceId, tempLine } = this._linkState;
      this._linkState = null;
      tempLine.remove();

      const targetEl = e.target.closest?.(".ca-node");
      const targetId = targetEl?.dataset?.nodeId;
      if (targetId && targetId !== sourceId) {
        await this._saveLink(sourceId, targetId);
      }
    }
  }

  /**
   * Creates a new node at the workspace center and saves it.
   * @returns {Promise<void>}
   */
  async _onAddNode() {
    const graph = game.settings.get("click-adventure", "graph");
    const workspace = this.element?.querySelector(".ca-workspace");
    const w = workspace?.clientWidth  ?? 600;
    const h = workspace?.clientHeight ?? 400;

    const newNode = {
      id: foundry.utils.randomID(),
      label: "Scene",
      imageSrc: "",
      x: Math.round((w - NODE_W) / 2),
      y: Math.round((h - NODE_H) / 2)
    };

    await game.settings.set("click-adventure", "graph", {
      nodes: [...graph.nodes, newNode],
      links: graph.links
    });
    this.render({ force: true });
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
    const graph = game.settings.get("click-adventure", "graph");
    const nodes = graph.nodes.map(n => n.id === nodeId ? { ...n, x, y } : n);
    await game.settings.set("click-adventure", "graph", { nodes, links: graph.links });
    this._renderLinks();
  }

  /**
   * Persists a new directed link between two nodes, skipping duplicates.
   * @param {string} sourceId
   * @param {string} targetId
   * @returns {Promise<void>}
   */
  async _saveLink(sourceId, targetId) {
    const graph = game.settings.get("click-adventure", "graph");
    const duplicate = graph.links.some(l => l.sourceId === sourceId && l.targetId === targetId);
    if (duplicate) return;

    await game.settings.set("click-adventure", "graph", {
      nodes: graph.nodes,
      links: [...graph.links, { sourceId, targetId }]
    });
    this.render({ force: true });
  }

  // ---------------------------------------------------------------------------
  // SVG rendering
  // ---------------------------------------------------------------------------

  /**
   * Redraws all persistent SVG link lines from the current setting state.
   * Uses the node elements' inline style positions so the lines track correctly
   * during an in-progress drag (before the position is saved).
   * Called from _onRender and after every graph mutation.
   */
  _renderLinks() {
    const workspace = this.element?.querySelector(".ca-workspace");
    if (!workspace) return;
    const svg = workspace.querySelector(".ca-links-layer");
    if (!svg) return;

    const graph = game.settings.get("click-adventure", "graph");

    // Remove only permanent links; leave the transient .ca-temp-link intact
    svg.querySelectorAll(".ca-link").forEach(el => el.remove());

    for (const link of graph.links) {
      const srcEl = workspace.querySelector(`[data-node-id="${link.sourceId}"]`);
      const tgtEl = workspace.querySelector(`[data-node-id="${link.targetId}"]`);
      if (!srcEl || !tgtEl) continue;

      // Read inline style set by the template / drag handler for live accuracy
      const x1 = (parseFloat(srcEl.style.left) || 0) + NODE_W / 2;
      const y1 = (parseFloat(srcEl.style.top)  || 0) + NODE_H / 2;
      const x2 = (parseFloat(tgtEl.style.left) || 0) + NODE_W / 2;
      const y2 = (parseFloat(tgtEl.style.top)  || 0) + NODE_H / 2;

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.classList.add("ca-link");
      line.setAttribute("x1", x1);
      line.setAttribute("y1", y1);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2);
      svg.appendChild(line);
    }
  }
}
