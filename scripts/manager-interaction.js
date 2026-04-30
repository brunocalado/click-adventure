/**
 * Drag, pan, and link-draw interaction handlers for the Manager workspace.
 * Extracted from ManagerApp to keep the main shell small.
 *
 * Every function receives the ManagerApp instance as `app` so it can
 * access `app.element`, `app._dragState`, `app._linkState`, `app._panState`, `app._pan`.
 */

import { NodeConfigApp } from "./node-config-app.js";
import { getGraphData, saveGraphData } from "./node-utils.js";
import { bezierOffset, renderLinks, NODE_W, NODE_H } from "./manager-graph.js";

/**
 * Virtual canvas size in pixels.
 * @shared-with-css: --ca-canvas-size in styles/_tokens.css
 */
export const CANVAS_SIZE = 8000;

// ---------------------------------------------------------------------------
// Node interaction
// ---------------------------------------------------------------------------

/**
 * Begins a node drag operation.
 * @param {ManagerApp} app
 * @param {MouseEvent} e
 * @param {HTMLElement} nodeEl
 */
export function onNodeMouseDown(app, e, nodeEl) {
  // Let anchor mousedown propagate independently
  if (e.target.classList.contains("ca-anchor")) return;
  e.preventDefault();
  e.stopPropagation();

  const nodeRect = nodeEl.getBoundingClientRect();
  app._dragState = {
    nodeId: nodeEl.dataset.nodeId,
    nodeEl,
    offsetX: e.clientX - nodeRect.left,
    offsetY: e.clientY - nodeRect.top
  };
}

/**
 * Opens NodeConfigApp for the double-clicked node.
 * @param {ManagerApp} app
 * @param {MouseEvent} e
 * @param {HTMLElement} nodeEl
 */
export function onNodeDblClick(app, e, nodeEl) {
  e.preventDefault();
  new NodeConfigApp(nodeEl.dataset.nodeId).render(true);
}

// ---------------------------------------------------------------------------
// Anchor / link-draw
// ---------------------------------------------------------------------------

/**
 * Begins a link-draw operation from the clicked anchor dot.
 * @param {ManagerApp} app
 * @param {MouseEvent} e
 * @param {HTMLElement} anchor
 */
export function onAnchorMouseDown(app, e, anchor) {
  e.preventDefault();
  e.stopPropagation();

  const nodeEl = anchor.closest(".ca-node");
  const workspace = app.element.querySelector(".ca-workspace");
  const wsRect = workspace.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();

  const startX = anchorRect.left + anchorRect.width / 2 - wsRect.left;
  const startY = anchorRect.top + anchorRect.height / 2 - wsRect.top;

  const svg = workspace.querySelector(".ca-links-layer");
  const srcAnchor = anchor.dataset.anchor;
  const c = bezierOffset(srcAnchor);

  const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  tempPath.classList.add("ca-temp-link");
  // Degenerate initial path — updated on every mousemove
  tempPath.setAttribute("d", `M ${startX},${startY} C ${startX + c.dx},${startY + c.dy} ${startX},${startY} ${startX},${startY}`);
  svg.appendChild(tempPath);

  app._linkState = {
    sourceId: nodeEl.dataset.nodeId,
    sourceAnchor: srcAnchor,
    startX,
    startY,
    tempLine: tempPath   // property name kept so onDocMouseMove and onDocMouseUp still work
  };
}

// ---------------------------------------------------------------------------
// Document-level move / up
// ---------------------------------------------------------------------------

/**
 * Updates drag position or temp link line as the pointer moves.
 * Document-level listener — fires even when pointer is outside the workspace.
 * @param {ManagerApp} app
 * @param {MouseEvent} e
 */
export function onDocMouseMove(app, e) {
  if (!app._dragState && !app._linkState && !app._panState) return;

  if (app._panState) {
    const workspace = app.element?.querySelector(".ca-workspace");
    if (!workspace) return;
    const wsW = workspace.clientWidth;
    const wsH = workspace.clientHeight;

    const dx = e.clientX - app._panState.startX;
    const dy = e.clientY - app._panState.startY;

    const newX = Math.min(0, Math.max(-(CANVAS_SIZE - wsW), app._panState.originX + dx));
    const newY = Math.min(0, Math.max(-(CANVAS_SIZE - wsH), app._panState.originY + dy));

    app._pan.x = newX;
    app._pan.y = newY;

    const canvas = app.element?.querySelector(".ca-canvas");
    if (canvas) canvas.style.transform = `translate(${newX}px, ${newY}px)`;
    return; // pan and drag are mutually exclusive
  }

  const workspace = app.element?.querySelector(".ca-workspace");
  if (!workspace) return;
  const wsRect = workspace.getBoundingClientRect();

  if (app._dragState) {
    const { nodeEl, offsetX, offsetY } = app._dragState;
    const rawX = e.clientX - wsRect.left - app._pan.x - offsetX;
    const rawY = e.clientY - wsRect.top  - app._pan.y - offsetY;
    nodeEl.style.left = `${Math.max(0, Math.min(CANVAS_SIZE - NODE_W, Math.round(rawX)))}px`;
    nodeEl.style.top  = `${Math.max(0, Math.min(CANVAS_SIZE - NODE_H, Math.round(rawY)))}px`;
    renderLinks(app);
  }

  if (app._linkState) {
    const { tempLine: tempPath, startX, startY, sourceAnchor } = app._linkState;
    const mx = e.clientX - wsRect.left;
    const my = e.clientY - wsRect.top;
    const c1 = bezierOffset(sourceAnchor);
    tempPath.setAttribute("d",
      `M ${startX},${startY} C ${startX + c1.dx},${startY + c1.dy} ${mx},${my} ${mx},${my}`
    );
  }
}

/**
 * Finalises drag (saves position) or link draw (saves link or discards).
 * Document-level listener — fires even when pointer is outside the workspace.
 * @param {ManagerApp} app
 * @param {MouseEvent} e
 * @returns {Promise<void>}
 */
export async function onDocMouseUp(app, e) {
  if (app._panState) {
    app._panState = null;
    game.settings.set("click-adventure", "managerPan", { x: app._pan.x, y: app._pan.y });
    return;
  }

  if (app._dragState) {
    const { nodeId, nodeEl, offsetX, offsetY } = app._dragState;
    app._dragState = null;

    const workspace = app.element?.querySelector(".ca-workspace");
    const wsRect = workspace?.getBoundingClientRect();
    if (wsRect) {
      const x = Math.max(0, Math.min(CANVAS_SIZE - NODE_W, Math.round(e.clientX - wsRect.left - app._pan.x - offsetX)));
      const y = Math.max(0, Math.min(CANVAS_SIZE - NODE_H, Math.round(e.clientY - wsRect.top  - app._pan.y - offsetY)));
      await saveNodePosition(app, nodeId, x, y);
    }
  }

  if (app._linkState) {
    const { sourceId, sourceAnchor, tempLine } = app._linkState;
    app._linkState = null;
    tempLine.remove();

    const targetEl = e.target.closest?.(".ca-node");
    const targetId = targetEl?.dataset?.nodeId;
    if (targetId && targetId !== sourceId) {
      const targetAnchorEl = e.target.closest?.(".ca-anchor");
      const targetAnchor = targetAnchorEl?.dataset?.anchor ?? nearestAnchor(e, targetEl);
      await saveLink(app, sourceId, sourceAnchor, targetId, targetAnchor);
    }
  }
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/**
 * Persists the new x/y of a node after a drag.
 * @param {ManagerApp} app
 * @param {string} nodeId
 * @param {number} x
 * @param {number} y
 * @returns {Promise<void>}
 */
export async function saveNodePosition(app, nodeId, x, y) {
  const { sceneId, startNodeId, nodes: rawNodes, links } = getGraphData();
  const nodes = rawNodes.map(n => n.id === nodeId ? { ...n, x, y } : n);
  await saveGraphData({ sceneId, startNodeId, nodes, links });
  renderLinks(app);
}

/**
 * Persists a new directed link between two anchor points, skipping duplicates.
 * @param {ManagerApp} app
 * @param {string} sourceId
 * @param {string} sourceAnchor
 * @param {string} targetId
 * @param {string} targetAnchor
 * @returns {Promise<void>}
 */
export async function saveLink(app, sourceId, sourceAnchor, targetId, targetAnchor) {
  const { sceneId, startNodeId, nodes, links } = getGraphData();
  const duplicate = links.some(l =>
    l.sourceId === sourceId && l.sourceAnchor === sourceAnchor &&
    l.targetId === targetId && l.targetAnchor === targetAnchor
  );
  if (duplicate) return;

  await saveGraphData({
    sceneId, startNodeId, nodes,
    links: [...links, { sourceId, sourceAnchor, targetId, targetAnchor, passages: [{ label: "", direction: "both" }] }]
  });
  app.render({ force: true });
}

/**
 * Returns the anchor side closest to the pointer — used when mouseup lands on the
 * node body rather than an anchor dot.
 * @param {MouseEvent} e
 * @param {HTMLElement} nodeEl
 * @returns {string} "top" | "right" | "bottom" | "left"
 */
export function nearestAnchor(e, nodeEl) {
  const r = nodeEl.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const dx = e.clientX - cx;
  const dy = e.clientY - cy;
  return Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? "right" : "left")
    : (dy > 0 ? "bottom" : "top");
}
