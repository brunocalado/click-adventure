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
import { buildSceneData } from "./scene-template.js";

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
     * @type {{ sourceId: string, sourceAnchor: string, startX: number, startY: number, tempLine: SVGPathElement }|null}
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
   * @returns {{ sceneId: string, currentNodeId: string, nodes: object[], links: object[] }}
   */
  _graphData() {
    const graph = game.settings.get("click-adventure", "graph");
    const raw = typeof graph?.toObject === "function" ? graph.toObject() : (graph ?? {});
    return {
      sceneId: raw.sceneId ?? "",
      currentNodeId: raw.currentNodeId ?? "",
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
    const { nodes, links, sceneId, currentNodeId } = this._graphData();
    context.nodes = nodes;
    context.links = links;
    context.currentNodeId = currentNodeId ?? "";

    // Validate that the linked scene still exists in the world.
    // If it was deleted externally, clear the stale sceneId silently so the
    // template renders the "New Scene" button without requiring a manual click.
    if (sceneId && !game.scenes.get(sceneId)) {
      await game.settings.set("click-adventure", "graph", { sceneId: "", nodes, links });
      context.graphSceneId = "";
    } else {
      context.graphSceneId = sceneId ?? "";
    }

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

    html.querySelectorAll(".ca-set-current-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        this._onSetCurrentNode(btn.dataset.nodeId);
      });
    });

    html.querySelectorAll(".ca-anchor").forEach(anchor => {
      anchor.addEventListener("mousedown", e => this._onAnchorMouseDown(e, anchor));
    });

    html.querySelector(".ca-add-node")?.addEventListener("click", () => this._onAddNode());
    html.querySelector(".ca-auto-arrange")?.addEventListener("click", () => this._onAutoArrange());
    html.querySelector(".ca-new-scene")?.addEventListener("click", () => this._onNewScene());
    html.querySelector(".ca-view-scene")?.addEventListener("click", () => this._onViewScene());
    html.querySelector(".ca-reset-graph")?.addEventListener("click", () => this._onResetGraph());

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
    const { sceneId, currentNodeId, nodes, links } = this._graphData();
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
      sceneId, currentNodeId, nodes: [...nodes, newNode], links
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
    const { sceneId, currentNodeId, nodes: rawNodes, links } = this._graphData();
    const nodes = rawNodes.map(n => n.id === nodeId ? { ...n, x, y } : n);
    await game.settings.set("click-adventure", "graph", { sceneId, currentNodeId, nodes, links });
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
    const { sceneId, currentNodeId, nodes, links } = this._graphData();
    const duplicate = links.some(l =>
      l.sourceId === sourceId && l.sourceAnchor === sourceAnchor &&
      l.targetId === targetId && l.targetAnchor === targetAnchor
    );
    if (duplicate) return;

    await game.settings.set("click-adventure", "graph", {
      sceneId, currentNodeId, nodes,
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

    // Remove only permanent links; leave the transient .ca-temp-link intact
    svg.querySelectorAll(".ca-link, .ca-link-hit").forEach(el => el.remove());

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
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.classList.add("ca-link");
      path.setAttribute("d", d);
      path.style.pointerEvents = "none";
      svg.appendChild(path);

      // Invisible wide hit-area path — easy right-click target, toggles hover state on the visible path
      const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hitPath.classList.add("ca-link-hit");
      hitPath.setAttribute("d", d);
      hitPath.dataset.linkIndex = String(i);
      hitPath.style.pointerEvents = "visibleStroke";
      hitPath.addEventListener("contextmenu", e => {
        e.preventDefault();
        e.stopPropagation();
        this._onDeleteLink(e, hitPath);
      });
      hitPath.addEventListener("mouseenter", () => path.classList.add("ca-link--hover"));
      hitPath.addEventListener("mouseleave", () => path.classList.remove("ca-link--hover"));
      svg.appendChild(hitPath);
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
      sceneId: freshGraph.sceneId,
      currentNodeId: freshGraph.currentNodeId,
      nodes: freshGraph.nodes,
      links: filtered
    });
    this.render({ force: true });
  }

  /**
   * Sets the given node as the current position in the graph.
   * Defines the starting point for HUD navigation.
   * Triggered by the "Set Current" button on each node in the Manager workspace.
   *
   * @param {string} nodeId
   * @returns {Promise<void>}
   */
  async _onSetCurrentNode(nodeId) {
    const { sceneId, nodes, links } = this._graphData();
    await game.settings.set("click-adventure", "graph", {
      sceneId,
      currentNodeId: nodeId,
      nodes,
      links
    });
    // Refresh HUD immediately if open so destinations reflect the new position
    if (globalThis.ClickAdventure._hud?.rendered) {
      globalThis.ClickAdventure._hud.render({ force: true });
    }
    this.render({ force: true });
  }

  /**
   * Repositions all nodes using a layered graph layout based on link topology.
   * Algorithm: topological sort → assign depth levels → position columns left-to-right.
   * Nodes with no links are placed in a final column on the right.
   * This only affects cosmetic x/y — no link data is modified.
   *
   * Triggered by the Auto Arrange toolbar button.
   * @returns {Promise<void>}
   */
  async _onAutoArrange() {
    const { sceneId, currentNodeId, nodes, links } = this._graphData();
    if (nodes.length === 0) return;

    const NODE_W = 120;
    const NODE_H = 100;
    const COL_GAP = 80;
    const ROW_GAP = 40;

    // Build adjacency: sourceId → Set of targetIds
    const outEdges = new Map(nodes.map(n => [n.id, new Set()]));
    const inDegree = new Map(nodes.map(n => [n.id, 0]));
    for (const link of links) {
      outEdges.get(link.sourceId)?.add(link.targetId);
      inDegree.set(link.targetId, (inDegree.get(link.targetId) ?? 0) + 1);
    }

    // Kahn's algorithm for topological layering
    const level = new Map();
    const queue = nodes.filter(n => (inDegree.get(n.id) ?? 0) === 0).map(n => n.id);
    queue.forEach(id => level.set(id, 0));

    let head = 0;
    while (head < queue.length) {
      const id = queue[head++];
      for (const targetId of (outEdges.get(id) ?? [])) {
        const nextLevel = (level.get(id) ?? 0) + 1;
        if (!level.has(targetId) || level.get(targetId) < nextLevel) {
          level.set(targetId, nextLevel);
        }
        inDegree.set(targetId, (inDegree.get(targetId) ?? 1) - 1);
        if (inDegree.get(targetId) === 0) queue.push(targetId);
      }
    }

    // Nodes not reached (cycles or isolated) go to a final column
    const maxLevel = Math.max(0, ...level.values());
    nodes.forEach(n => { if (!level.has(n.id)) level.set(n.id, maxLevel + 1); });

    // Group nodes by level
    const columns = new Map();
    for (const n of nodes) {
      const col = level.get(n.id) ?? 0;
      if (!columns.has(col)) columns.set(col, []);
      columns.get(col).push(n.id);
    }

    // Compute column x positions
    const colX = new Map();
    let x = COL_GAP;
    for (const col of [...columns.keys()].sort((a, b) => a - b)) {
      colX.set(col, x);
      x += NODE_W + COL_GAP;
    }

    // Assign y positions within each column, centred in the workspace
    const workspace = this.element?.querySelector(".ca-workspace");
    const wsH = workspace?.clientHeight ?? 500;

    const updatedNodes = nodes.map(n => {
      const col = level.get(n.id) ?? 0;
      const colNodes = columns.get(col) ?? [];
      const rowIndex = colNodes.indexOf(n.id);
      const totalH = colNodes.length * NODE_H + (colNodes.length - 1) * ROW_GAP;
      const startY = Math.max(ROW_GAP, (wsH - totalH) / 2);
      return {
        ...n,
        x: colX.get(col) ?? COL_GAP,
        y: startY + rowIndex * (NODE_H + ROW_GAP)
      };
    });

    await game.settings.set("click-adventure", "graph", { sceneId, currentNodeId, nodes: updatedNodes, links });
    this.render({ force: true });
  }

  /**
   * Creates a new Foundry Scene and binds it to this graph at the top level.
   * Only one scene can be linked per graph; this button is hidden once linked.
   *
   * Triggered by the "New Scene" toolbar button.
   * @returns {Promise<void>}
   */
  async _onNewScene() {
    // Guard: if a scene is already linked, this button should not be reachable
    const { sceneId: existing, currentNodeId, nodes, links } = this._graphData();
    if (existing) return;

    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: "New Scene" },
      content: `
        <div style="padding: 8px 0;">
          <label style="display:block; margin-bottom:6px;">Scene Name</label>
          <input type="text" name="sceneName" value="Click Adventure Scene"
                 style="width:100%;" autofocus/>
        </div>
      `,
      ok: {
        label: "Create",
        callback: (event, button) => button.form.elements.sceneName.value.trim()
      },
      rejectClose: false
    });
    if (!result) return;

    const data = buildSceneData(result);
    const scene = await Scene.create(data);
    if (!scene) return;

    // Bind the scene to the graph at the top level — not to any individual node
    await game.settings.set("click-adventure", "graph", {
      sceneId: scene.id, currentNodeId, nodes, links
    });

    ui.notifications.info(`Scene "${scene.name}" created and linked to this graph.`);
    this.render({ force: true });
  }

  /**
   * Activates the Foundry Scene linked to this graph.
   * If the scene no longer exists, clears the sceneId from the graph and re-renders
   * the toolbar so the "New Scene" button becomes available again.
   *
   * Triggered by the "View Scene" toolbar button when a scene is already linked.
   * Note: scene.activate() changes the active scene for all connected players.
   * @returns {Promise<void>}
   */
  async _onViewScene() {
    const { sceneId, nodes, links } = this._graphData();
    if (!sceneId) return;

    const scene = game.scenes.get(sceneId);

    if (!scene) {
      // Scene was deleted externally — clear the binding and restore the "New Scene" button
      await game.settings.set("click-adventure", "graph", { sceneId: "", nodes, links });
      ui.notifications.warn("The linked scene no longer exists. You can create a new one.");
      this.render({ force: true });
      return;
    }

    // Activate the scene on the canvas (visible to all players)
    await scene.activate();
  }

  /**
   * Resets the entire graph — clears all nodes, links, sceneId and currentNodeId.
   * Requires explicit confirmation before proceeding.
   * Triggered by the "Reset" toolbar button.
   * @returns {Promise<void>}
   */
  async _onResetGraph() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Reset Graph" },
      content: "<p>This will delete <strong>all nodes, links and scene binding</strong>. This cannot be undone.</p><p>Are you sure?</p>",
      rejectClose: false
    });
    if (!confirmed) return;

    await game.settings.set("click-adventure", "graph", {
      sceneId: "",
      currentNodeId: "",
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
