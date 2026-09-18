/**
 * SVG link rendering and Bézier geometry for the Manager workspace.
 * Extracted from ManagerApp to keep the main shell small.
 *
 * Every function receives the ManagerApp instance as `app` so it can
 * access `app.element`, `app._pan`, and sibling methods via delegation.
 */

import { LinkEditorApp } from "./link-editor-app.js";
import {
  getGraphData, saveGraphData, isMultiPassage, getFirstPassage,
  decomposeDirection, cyclePassageDirection, cyclePassageState
} from "./node-utils.js";

/** Perpendicular gap between the stacked lines of a multi-passage link, in canvas px. */
const MULTI_LINE_GAP = 3;

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
    case "top":      return { dx:  0,       dy: -tension };
    case "right":    return { dx:  tension, dy:  0       };
    case "bottom":   return { dx:  0,       dy:  tension };
    case "left":     return { dx: -tension, dy:  0       };
    case "peek-tl":  return { dx: -tension, dy: -tension };
    case "peek-tr":  return { dx:  tension, dy: -tension };
    case "peek-bl":  return { dx: -tension, dy:  tension };
    case "peek-br":  return { dx:  tension, dy:  tension };
    default:         return { dx:  tension, dy:  0       };
  }
}

/**
 * Returns the canvas-space center of a named anchor dot on a node.
 * Reads live DOM position so it stays accurate during drags.
 * The zoom factor must be provided so screen coords are correctly converted to canvas coords
 * when the canvas has a CSS scale transform applied.
 * @param {HTMLElement} nodeEl — the .ca-node element
 * @param {string} side       — "top" | "right" | "bottom" | "left"
 * @param {DOMRect} wsRect    — workspace getBoundingClientRect()
 * @param {{ x: number, y: number }} pan — current pan offset
 * @param {number} zoom       — current zoom level (default 1)
 * @returns {{ x: number, y: number }}
 */
export function anchorPoint(nodeEl, side, wsRect, pan, zoom = 1) {
  const dot = nodeEl.querySelector(`.ca-anchor[data-anchor="${side}"]`);
  if (dot) {
    const r = dot.getBoundingClientRect();
    return {
      x: (r.left + r.width  / 2 - wsRect.left - pan.x) / zoom,
      y: (r.top  + r.height / 2 - wsRect.top  - pan.y) / zoom
    };
  }
  // Fallback when the anchor dot is not in the DOM
  const nx = parseFloat(nodeEl.style.left) || 0;
  const ny = parseFloat(nodeEl.style.top)  || 0;
  const offsets = {
    top:       { x: NODE_W / 2, y: 0          },
    right:     { x: NODE_W,     y: NODE_H / 2 },
    bottom:    { x: NODE_W / 2, y: NODE_H     },
    left:      { x: 0,          y: NODE_H / 2 },
    "peek-tl": { x: 0,          y: 0          },
    "peek-tr": { x: NODE_W,     y: 0          },
    "peek-bl": { x: 0,          y: NODE_H     },
    "peek-br": { x: NODE_W,     y: NODE_H     }
  };
  return { x: nx + (offsets[side]?.x ?? NODE_W / 2), y: ny + (offsets[side]?.y ?? 0) };
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
 * Splits a passage into its two axes, accepting both the current two-field shape and the
 * pre-0.3.0 combined string. Rendering is the one place that still meets raw legacy data
 * head-on, because a graph is drawn before anything has been touched in the editor.
 *
 * @param {object} passage
 * @returns {{direction: string, state: string}}
 */
function passageAxes(passage) {
  if (passage?.state !== undefined) {
    return { direction: passage.direction ?? "both", state: passage.state };
  }
  const { dirAxis, stateAxis } = decomposeDirection(passage?.direction ?? "both");
  return { direction: dirAxis, state: stateAxis };
}

/**
 * Builds the cubic Bézier `d` attribute for a link, optionally displaced sideways so the
 * passages of a multi-passage link stack as parallel lines instead of overlapping. The
 * offset is perpendicular to the straight chord between the two anchors — exact enough at
 * these gaps, and far cheaper than offsetting the curve properly.
 *
 * @param {{x: number, y: number}} p1
 * @param {{dx: number, dy: number}} c1
 * @param {{x: number, y: number}} p2
 * @param {{dx: number, dy: number}} c2
 * @param {number} [offset] - perpendicular displacement in canvas px
 * @returns {string}
 */
function bezierPath(p1, c1, p2, c2, offset = 0) {
  let ox = 0;
  let oy = 0;
  if (offset !== 0) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    ox = (-dy / len) * offset;
    oy = ( dx / len) * offset;
  }
  return `M ${p1.x + ox},${p1.y + oy} `
    + `C ${p1.x + c1.dx + ox},${p1.y + c1.dy + oy} `
    + `${p2.x + c2.dx + ox},${p2.y + c2.dy + oy} `
    + `${p2.x + ox},${p2.y + oy}`;
}

/**
 * Appends one visible link path to the SVG layer.
 *
 * @param {SVGElement} svg
 * @param {string} d
 * @param {{direction: string, state: string, peek?: boolean, thin?: boolean}} opts
 * @returns {SVGPathElement}
 */
function appendLinkPath(svg, d, opts) {
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.classList.add("ca-link");
  if (opts.peek) path.classList.add("ca-link--peek");
  if (opts.thin) path.classList.add("ca-link--thin");
  path.setAttribute("d", d);
  path.dataset.direction = opts.direction;
  path.dataset.state     = opts.state;
  path.style.pointerEvents = "none";
  svg.appendChild(path);
  return path;
}

/**
 * Appends the midpoint marker for one passage: a rotated arrowhead for a one-way passage,
 * or a state glyph for a bidirectional one. Secret uses a real Font Awesome mask path
 * rather than the 🎭 emoji — a colour emoji ignores SVG `fill`, so the state colour never
 * reached it.
 *
 * @param {SVGElement} svg
 * @param {{x: number, y: number}} mid
 * @param {number} angle - curve tangent at the midpoint, in degrees
 * @param {{direction: string, state: string}} axes
 */
function appendPassageMarker(svg, mid, angle, { direction, state }) {
  if (direction !== "both") {
    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    arrow.classList.add("ca-link-direction-arrow");
    arrow.dataset.direction = direction;
    arrow.dataset.state     = state;
    arrow.setAttribute("points", "8,0 -6,-5 -6,5");
    arrow.setAttribute("transform",
      `translate(${mid.x}, ${mid.y}) rotate(${direction === "forward" ? angle : angle + 180})`);
    arrow.style.pointerEvents = "none";
    svg.appendChild(arrow);
    return;
  }

  const glyphs = { open: "⟷", blocked: "⊘", secret: "", custom: "" };
  const indicator = document.createElementNS("http://www.w3.org/2000/svg", "text");
  indicator.classList.add("ca-link-direction");
  indicator.setAttribute("x", mid.x);
  indicator.setAttribute("y", mid.y);
  indicator.setAttribute("text-anchor", "middle");
  indicator.setAttribute("dominant-baseline", "central");
  indicator.dataset.state = state;
  indicator.style.pointerEvents = "none";
  indicator.textContent = glyphs[state] ?? "⟷";
  svg.appendChild(indicator);
}

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
  const zoom = app._zoom ?? 1;

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const srcEl = workspace.querySelector(`[data-node-id="${link.sourceId}"]`);
    const tgtEl = workspace.querySelector(`[data-node-id="${link.targetId}"]`);
    if (!srcEl || !tgtEl) continue;

    const sourceAnchor = link.sourceAnchor ?? "right";
    const targetAnchor = link.targetAnchor ?? "left";
    const p1 = anchorPoint(srcEl, sourceAnchor, wsRect, app._pan, zoom);
    const p2 = anchorPoint(tgtEl, targetAnchor, wsRect, app._pan, zoom);
    const c1 = bezierOffset(sourceAnchor);
    const c2 = bezierOffset(targetAnchor);
    const d = bezierPath(p1, c1, p2, c2);

    const isPeek = link.type === "peek";
    const multi = !isPeek && isMultiPassage(link);
    // Passages are drawn individually so a multi-passage link shows each one's own state
    // side by side, instead of collapsing them into one line plus a "worst state" badge.
    const passages = isPeek ? [] : (link.passages?.length ? link.passages : [getFirstPassage(link)]);

    // Visible path(s) — pointer events disabled so the hit area path on top handles interactions
    const drawnPaths = [];
    if (isPeek) {
      // "peek" rather than a real state: a [data-state] rule outweighs .ca-link--peek
      // on specificity, so giving a peek link a normal state repaints it that colour.
      drawnPaths.push(appendLinkPath(svg, d, { direction: "both", state: "peek", peek: true }));
    } else {
      const spread = (passages.length - 1) / 2;
      passages.forEach((passage, pi) => {
        const axes = passageAxes(passage);
        const offset = multi ? (pi - spread) * MULTI_LINE_GAP : 0;
        const pd = offset === 0 ? d : bezierPath(p1, c1, p2, c2, offset);
        drawnPaths.push(appendLinkPath(svg, pd, { ...axes, thin: multi }));
      });
    }

    // Invisible wide hit-area path — easy right-click target, toggles hover state on the visible path
    const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hitPath.classList.add("ca-link-hit");
    hitPath.setAttribute("d", d);
    hitPath.dataset.linkIndex = String(i);
    hitPath.style.pointerEvents = "visibleStroke";
    hitPath.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      // Peek links don't cycle and don't open the passage editor
      if (isPeek) return;
      // Shift+click or multi-passage link → open editor. On a single-passage link a plain
      // click cycles direction and Ctrl/Cmd+click cycles state — the two axes are edited
      // separately, so reaching a given combination never takes more than a few clicks.
      if (e.shiftKey || multi) {
        new LinkEditorApp(i).render(true);
      } else {
        onCycleLink(app, i, (e.ctrlKey || e.metaKey) ? "state" : "direction");
      }
    });
    hitPath.addEventListener("contextmenu", e => {
      e.preventDefault();
      e.stopPropagation();
      onDeleteLink(app, e, hitPath);
    });
    hitPath.addEventListener("mouseenter", () => drawnPaths.forEach(p => p.classList.add("ca-link--hover")));
    hitPath.addEventListener("mouseleave", () => drawnPaths.forEach(p => p.classList.remove("ca-link--hover")));
    svg.appendChild(hitPath);

    // Midpoint indicator
    const mid = pathMidpoint(p1, c1, p2, c2);

    if (isPeek) {
      // Eye icon to distinguish peek links from navigation links
      const indicator = document.createElementNS("http://www.w3.org/2000/svg", "text");
      indicator.classList.add("ca-link-direction");
      indicator.setAttribute("x", mid.x);
      indicator.setAttribute("y", mid.y);
      indicator.setAttribute("text-anchor", "middle");
      indicator.setAttribute("dominant-baseline", "central");
      indicator.dataset.state = "peek";
      indicator.style.pointerEvents = "none";
      indicator.textContent = "👁";
      svg.appendChild(indicator);
    } else if (multi) {
      // The stacked lines already show every passage's state; the badge only marks the
      // link as the kind that opens the editor rather than cycling on click.
      const indicator = document.createElementNS("http://www.w3.org/2000/svg", "text");
      indicator.classList.add("ca-link-direction");
      indicator.setAttribute("x", mid.x);
      indicator.setAttribute("y", mid.y);
      indicator.setAttribute("text-anchor", "middle");
      indicator.setAttribute("dominant-baseline", "central");
      indicator.dataset.state = "multi";
      indicator.style.pointerEvents = "none";
      indicator.textContent = "⊕";
      svg.appendChild(indicator);
    } else {
      appendPassageMarker(svg, mid, pathTangentAngle(p1, c1, p2, c2), passageAxes(passages[0]));
    }
  }
}

// ---------------------------------------------------------------------------
// Link mutation handlers (kept here because they trigger renderLinks)
// ---------------------------------------------------------------------------

/**
 * Advances one axis of a single-passage link: direction (both → forward → backward) or
 * state (open → blocked → secret → custom). Triggered by left-click on a .ca-link-hit
 * element during renderLinks. Whichever axis is cycled, the passage is written back in
 * the two-field form, so touching a legacy link is also what converts it.
 *
 * @param {ManagerApp} app
 * @param {number} linkIndex
 * @param {"direction"|"state"} axis
 * @returns {Promise<void>}
 */
export async function onCycleLink(app, linkIndex, axis = "direction") {
  const { sceneId, startNodeId, nodes, links } = getGraphData();
  const updatedLinks = links.map((l, i) => {
    if (i !== linkIndex) return l;
    // Peek links have no direction — cycling is a no-op
    if (l.type === "peek") return l;
    // Multi-passage links are edited via LinkEditorApp — cycling is a no-op here
    if (isMultiPassage(l)) return l;
    const passage = getFirstPassage(l);
    const { direction, state } = passageAxes(passage);
    const updated = axis === "state"
      ? { direction, state: cyclePassageState(state) }
      : { direction: cyclePassageDirection(direction), state };
    return { ...l, passages: [{ ...passage, ...updated }] };
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
    classes: ["click-adventure", "ca-dialog"],
    content: "<p>Remove this connection?</p>",
    yes: { class: "ca-btn ca-btn--danger" },
    no:  { class: "ca-btn ca-btn--quiet" },
    rejectClose: false
  });
  if (!confirmed) return;

  // Re-fetch after dialog closes — user may have taken time to confirm
  const freshGraph = getGraphData();
  const filtered = freshGraph.links.filter((_, idx) => idx !== linkIndex);
  await saveGraphData({ links: filtered });
  app.render({ force: true });
}
