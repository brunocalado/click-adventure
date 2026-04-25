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
     * @type {{ sourceId: string, startX: number, startY: number, tempLine: SVGLineElement }|null}
     */
    this._linkState = null;

    // Bound versions kept so document listeners can be removed on close.
    this._docMouseMove = this._onDocMouseMove.bind(this);
    this._docMouseUp = this._onDocMouseUp.bind(this);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the graph as a plain POJO regardless of whether the setting returns
   * a DataModel instance (normal v14 behaviour) or a raw object (first-run default).
   * @returns {{ nodes: object[], links: object[] }}
   */
  _graphData() {
    const graph = game.settings.get("click-adventure", "graph");
    return typeof graph?.toObject === "function" ? graph.toObject() : (graph ?? { nodes: [], links: [] });
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
    const { nodes, links } = this._graphData();
    context.nodes = nodes;
    context.links = links;
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
    });

    html.querySelectorAll(".ca-anchor").forEach(anchor => {
      anchor.addEventListener("mousedown", e => this._onAnchorMouseDown(e, anchor));
    });

    html.querySelector(".ca-add-node")?.addEventListener("click", () => this._onAddNode());

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

    this._linkState = {
      sourceId: nodeEl.dataset.nodeId,
      sourceAnchor: anchor.dataset.anchor,
      tempLine
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
    const { nodes, links } = this._graphData();
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
      nodes: [...nodes, newNode],
      links
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
    const { nodes: rawNodes, links } = this._graphData();
    const nodes = rawNodes.map(n => n.id === nodeId ? { ...n, x, y } : n);
    await game.settings.set("click-adventure", "graph", { nodes, links });
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
    const { nodes, links } = this._graphData();
    const duplicate = links.some(l =>
      l.sourceId === sourceId && l.sourceAnchor === sourceAnchor &&
      l.targetId === targetId && l.targetAnchor === targetAnchor
    );
    if (duplicate) return;

    await game.settings.set("click-adventure", "graph", {
      nodes,
      links: [...links, { sourceId, sourceAnchor, targetId, targetAnchor }]
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

    // Remove only permanent links; leave the transient .ca-temp-link intact
    svg.querySelectorAll(".ca-link, .ca-link-hit").forEach(el => el.remove());

    const wsRect = workspace.getBoundingClientRect();

    for (let i = 0; i < links.length; i++) {
      const link = links[i];
      const srcEl = workspace.querySelector(`[data-node-id="${link.sourceId}"]`);
      const tgtEl = workspace.querySelector(`[data-node-id="${link.targetId}"]`);
      if (!srcEl || !tgtEl) continue;

      const p1 = this._anchorPoint(srcEl, link.sourceAnchor ?? "right", wsRect);
      const p2 = this._anchorPoint(tgtEl, link.targetAnchor ?? "left",  wsRect);

      // Visible line — pointer events disabled so the hit area line on top handles interactions
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.classList.add("ca-link");
      line.setAttribute("x1", p1.x); line.setAttribute("y1", p1.y);
      line.setAttribute("x2", p2.x); line.setAttribute("y2", p2.y);
      line.style.pointerEvents = "none";
      svg.appendChild(line);

      // Invisible wide hit-area line — easy right-click target, toggles hover state on the visible line
      const hitLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      hitLine.classList.add("ca-link-hit");
      hitLine.setAttribute("x1", p1.x); hitLine.setAttribute("y1", p1.y);
      hitLine.setAttribute("x2", p2.x); hitLine.setAttribute("y2", p2.y);
      hitLine.dataset.linkIndex = String(i);
      hitLine.style.pointerEvents = "visibleStroke";
      hitLine.addEventListener("contextmenu", e => {
        e.preventDefault();
        e.stopPropagation();
        this._onDeleteLink(e, hitLine);
      });
      hitLine.addEventListener("mouseenter", () => line.classList.add("ca-link--hover"));
      hitLine.addEventListener("mouseleave", () => line.classList.remove("ca-link--hover"));
      svg.appendChild(hitLine);
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
      nodes: freshGraph.nodes,
      links: filtered
    });
    this.render({ force: true });
  }
}
