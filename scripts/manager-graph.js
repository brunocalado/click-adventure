/**
 * SVG link rendering and Bézier geometry for the Manager workspace.
 * Extracted from ManagerApp to keep the main shell small.
 *
 * Every function receives the ManagerApp instance as `app` so it can
 * access `app.element`, `app._pan`, and sibling methods via delegation.
 */

import { LinkEditorApp } from "./link-editor-app.js";
import { getGraphData, saveGraphData, isMultiPassage, getEffectiveDirection } from "./node-utils.js";

/**
 * Fixed node dimensions — must match CSS --ca-node-size.
 * @shared-with-css: styles/_tokens.css
 */
export const NODE_W = 100;
export const NODE_H = 100;

// ---------------------------------------------------------------------------
// Pure geometry helpers
// ---------------------------------------------------------------------------

/**
 * Returns the cubic Bézier control point offset for a given anchor side.
 * The control point is displaced outward from the anchor in its natural exit direction.
 *
 * @param {string} side     — "top" | "right" | "bottom" | "left"
 * @param {number} tension  — pixel distance of the control point from the anchor (default 80)
 * @returns {{ dx: number, dy: number }}
 */
export function bezierOffset(side, tension = 80) {
  switch (side) {
    case "top":    return { dx:  0,       dy: -tension };
    case "right":  return { dx:  tension, dy:  0       };
    case "bottom": return { dx:  0,       dy:  tension };
    case "left":   return { dx: -tension, dy:  0       };
    default:       return { dx:  tension, dy:  0       };
  }
}

/**
 * Returns the workspace-relative center of a named anchor dot on a node.
 * Reads live DOM position so it stays accurate during drags.
 * @param {HTMLElement} nodeEl — the .ca-node element
 * @param {string} side       — "top" | "right" | "bottom" | "left"
 * @param {DOMRect} wsRect    — workspace getBoundingClientRect()
 * @param {{ x: number, y: number }} pan — current pan offset
 * @returns {{ x: number, y: number }}
 */
export function anchorPoint(nodeEl, side, wsRect, pan) {
  const dot = nodeEl.querySelector(`.ca-anchor[data-anchor="${side}"]`);
  if (dot) {
    const r = dot.getBoundingClientRect();
    return {
      x: r.left + r.width  / 2 - wsRect.left - pan.x,
      y: r.top  + r.height / 2 - wsRect.top  - pan.y
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
export function pathMidpoint(p1, c1, p2, c2) {
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
export function pathTangentAngle(p1, c1, p2, c2) {
  const cp1 = { x: p1.x + c1.dx, y: p1.y + c1.dy };
  const cp2 = { x: p2.x + c2.dx, y: p2.y + c2.dy };
  const t = 0.5;
  const dx = 3*Math.pow(1-t,2)*(cp1.x-p1.x) + 6*(1-t)*t*(cp2.x-cp1.x) + 3*t*t*(p2.x-cp2.x);
  const dy = 3*Math.pow(1-t,2)*(cp1.y-p1.y) + 6*(1-t)*t*(cp2.y-cp1.y) + 3*t*t*(p2.y-cp2.y);
  return Math.atan2(dy, dx) * (180 / Math.PI);
}

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------

/**
 * Redraws all persistent SVG link lines from the current setting state.
 * Lines connect named anchor dots. Called from _onRender and after every graph mutation.
 * @param {ManagerApp} app
 */
export function renderLinks(app) {
  const workspace = app.element?.querySelector(".ca-workspace");
  if (!workspace) return;
  const svg = workspace.querySelector(".ca-links-layer");
  if (!svg) return;

  const { links } = getGraphData();

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
    const p1 = anchorPoint(srcEl, sourceAnchor, wsRect, app._pan);
    const p2 = anchorPoint(tgtEl, targetAnchor, wsRect, app._pan);
    const c1 = bezierOffset(sourceAnchor);
    const c2 = bezierOffset(targetAnchor);
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
        onCycleLink(app, i);
      }
    });
    hitPath.addEventListener("contextmenu", e => {
      e.preventDefault();
      e.stopPropagation();
      onDeleteLink(app, e, hitPath);
    });
    hitPath.addEventListener("mouseenter", () => path.classList.add("ca-link--hover"));
    hitPath.addEventListener("mouseleave", () => path.classList.remove("ca-link--hover"));
    svg.appendChild(hitPath);

    // Midpoint indicator — ⊕ for multi-passage, text for both/blocked, arrow for forward/backward
    const mid = pathMidpoint(p1, c1, p2, c2);

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
    } else if (direction === "both" || direction === "blocked" || direction === "locked") {
      const indicator = document.createElementNS("http://www.w3.org/2000/svg", "text");
      indicator.classList.add("ca-link-direction");
      indicator.setAttribute("x", mid.x);
      indicator.setAttribute("y", mid.y);
      indicator.setAttribute("text-anchor", "middle");
      indicator.setAttribute("dominant-baseline", "central");
      indicator.dataset.direction = direction;
      indicator.style.pointerEvents = "none";
      indicator.textContent = direction === "both" ? "⟷" : direction === "blocked" ? "✕" : "⊘";
      svg.appendChild(indicator);
    } else {
      // Arrowhead aligned with the curve tangent at t=0.5
      const angle = pathTangentAngle(p1, c1, p2, c2);
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

// ---------------------------------------------------------------------------
// Link mutation handlers (kept here because they trigger renderLinks)
// ---------------------------------------------------------------------------

/**
 * Cycles a link's direction through: both → forward → backward → blocked → locked → both.
 * Triggered by left-click on a .ca-link-hit element during renderLinks.
 * @param {ManagerApp} app
 * @param {number} linkIndex
 * @returns {Promise<void>}
 */
export async function onCycleLink(app, linkIndex) {
  const { sceneId, startNodeId, nodes, links } = getGraphData();
  const cycle = { both: "forward", forward: "backward", backward: "blocked", blocked: "locked", locked: "both" };
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
  await saveGraphData({ sceneId, startNodeId, nodes, links: updatedLinks });
  renderLinks(app);

  // Notify HUD immediately so destination list reflects the new link state
  const hud = globalThis.ClickAdventure._hud;
  if (hud?.rendered) hud.render({ force: true });
}

/**
 * Deletes a link after a right-click contextmenu event on its SVG line.
 * Uses a native Foundry DialogV2 confirmation to avoid accidental deletion.
 * @param {ManagerApp} app
 * @param {MouseEvent} e
 * @param {SVGPathElement} lineEl
 * @returns {Promise<void>}
 */
export async function onDeleteLink(app, e, lineEl) {
  const linkIndex = parseInt(lineEl.dataset.linkIndex, 10);

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Delete Link" },
    content: "<p>Remove this connection?</p>",
    rejectClose: false
  });
  if (!confirmed) return;

  // Re-fetch after dialog closes — user may have taken time to confirm
  const freshGraph = getGraphData();
  const filtered = freshGraph.links.filter((_, idx) => idx !== linkIndex);
  await saveGraphData({ links: filtered });
  app.render({ force: true });
}
