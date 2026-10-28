/*!
 * Click Adventure
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * One file format, written by hand or by the exporter. The export writes everything; a file
 * written by hand or by a script may leave out what is not adventure content (ids, anchors,
 * passages, Manager positions) and name nodes by label in its links. This fills those in before
 * the rest of the import runs, so the import pipeline only ever sees the export shape.
 *
 * Links resolve by exact label only: a typo is reported, never matched to a near room. A node
 * without an id gets a random one, not one derived from its label — a module that reimports while
 * players are in it writes ids.
 */

import { NODE_W, NODE_H } from "./manager-graph.js";
import { normalizeRoomName, flattenPoints } from "./flight-data.js";

const NAV_ANCHORS = ["top", "right", "bottom", "left"];
const PASSAGE_STATES = ["open", "blocked", "secret"];
const GRID_COLS = 6;

/**
 * Fills in what a hand-written or generated import file may leave out, so the rest of the
 * import sees the export shape. Fields already present are passed through untouched, so an
 * exported file comes out deep-equal to what went in.
 * @param {object} graph       one entry of the file's `graphs`
 * @param {string[]} warnings  mutable; one human-readable line per problem
 * @returns {object}           a new graph object
 */
export function normalizeImportGraph(graph, warnings) {
  const { start, ...rest } = graph;
  const where = `Group "${graph.name}"`;
  const nodes = (graph.nodes ?? []).map(node => normalizeNode(node, warnings, where));
  layoutFromRooms(nodes, graph.flight?.rooms);
  placeOnGrid(nodes);

  const byLabel = new Map();
  for (const n of nodes) byLabel.set(n.label, [...(byLabel.get(n.label) ?? []), n]);
  const byId = new Map(nodes.map(n => [n.id, n]));

  // An export writes "" for a group with no start node chosen, and that is kept as it is.
  let startNodeId = graph.startNodeId;
  if (start !== undefined) {
    const matches = byLabel.get(start) ?? [];
    if (matches.length === 1) startNodeId = matches[0].id;
    else {
      warnings.push(`${where}: start node "${start}" ${matches.length ? "matches several nodes" : "not found"} — the first node is used.`);
      startNodeId = undefined;
    }
  } else if (startNodeId && !byId.has(startNodeId)) {
    warnings.push(`${where}: start node id "${startNodeId}" not found — the first node is used.`);
    startNodeId = undefined;
  }
  if (startNodeId === undefined) startNodeId = nodes[0]?.id ?? "";

  const links = [];
  for (const link of (graph.links ?? [])) {
    const out = normalizeLink(link, byLabel, byId, warnings, where);
    if (out) links.push(out);
  }

  return { ...rest, startNodeId, nodes, links };
}

function normalizeNode(node, warnings, where) {
  let label = node.label;
  if (typeof label !== "string" || !label.trim()) {
    warnings.push(`${where}: a node has no label — it is called "Scene".`);
    label = "Scene";
  }
  const out = { ...node, label };
  if (!out.id) out.id = foundry.utils.randomID();
  if (Array.isArray(node.images)) {
    out.images = node.images.map(img => {
      if (typeof img === "string") return { id: foundry.utils.randomID(), src: img, label };
      if (img && typeof img === "object" && !img.id) return { ...img, id: foundry.utils.randomID(), label: img.label ?? label };
      return img;
    });
  }
  return out;
}

/**
 * Nodes missing x or y take their room's place on the overview map, scaled so the median distance
 * between neighbouring rooms becomes 180 Manager pixels. One scale from the median reproduces the
 * density the Lockwood build script reached with two hand-tuned factors, and keeps the map's
 * proportions. Scaling from the minimum distance avoids every overlap but spreads the nodes over a
 * mostly empty canvas, so the closest rooms are pushed apart afterwards instead.
 */
function layoutFromRooms(nodes, rawRooms) {
  const rooms = (Array.isArray(rawRooms) ? rawRooms : [])
    .map(r => ({ r, pts: flattenPoints(r?.points) }))
    .filter(({ pts }) => pts && pts.length >= 6 && pts.every(Number.isFinite))
    .map(({ r, pts }) => {
      let cx = 0, cy = 0;
      for (let i = 0; i < pts.length; i += 2) { cx += pts[i]; cy += pts[i + 1]; }
      return { name: r.name, node: r.node, cx: cx / (pts.length / 2), cy: cy / (pts.length / 2) };
    });
  if (rooms.length < 2) return;
  const nearest = rooms.map(a => Math.min(...rooms.filter(b => b !== a).map(b => Math.hypot(a.cx - b.cx, a.cy - b.cy))))
    .sort((a, b) => a - b);
  const mid = nearest.length >> 1;
  const median = nearest.length % 2 ? nearest[mid] : (nearest[mid - 1] + nearest[mid]) / 2;
  if (!(median > 0)) return;
  const s = 180 / median;

  // The same two rules applyFlightData links a room to a node by.
  const roomFor = label => rooms.find(r => r.node === label)
    ?? rooms.find(r => normalizeRoomName(r.name) === normalizeRoomName(label));
  const hasPosition = n => Number.isFinite(n.x) && Number.isFinite(n.y);
  const placed = nodes.filter(hasPosition).map(n => ({ x: n.x, y: n.y }));
  const overlaps = (x, y) => placed.some(b => Math.abs(x - b.x) < NODE_W + 20 && Math.abs(y - b.y) < NODE_H + 20);
  for (const n of nodes) {
    if (hasPosition(n)) continue;
    const room = roomFor(n.label);
    if (!room) continue;
    const x = Math.round(room.cx * s - NODE_W / 2);
    let y = Math.round(room.cy * s - NODE_H / 2);
    while (overlaps(x, y)) y += NODE_H + 20;
    n.x = x; n.y = y;
    placed.push({ x, y });
  }
}

/** Nodes missing x or y go on a grid below the lowest node that has a position, as a folder import lays them out. */
function placeOnGrid(nodes) {
  const placed = nodes.filter(n => Number.isFinite(n.x) && Number.isFinite(n.y));
  const top = placed.length ? Math.max(...placed.map(n => n.y)) + NODE_H + 40 : 20;
  let i = 0;
  for (const n of nodes) {
    if (Number.isFinite(n.x) && Number.isFinite(n.y)) continue;
    n.x = 20 + (i % GRID_COLS) * (NODE_W + 20);
    n.y = top + Math.floor(i / GRID_COLS) * (NODE_H + 40);
    i++;
  }
}

function resolveEnd(link, idKey, labelKey, byLabel, byId, warnings, where) {
  if (link[idKey]) return byId.get(link[idKey]) ?? { id: link[idKey] };
  const label = link[labelKey];
  const matches = byLabel.get(label) ?? [];
  if (matches.length === 1) return matches[0];
  warnings.push(`${where}: link ${labelKey} "${label}" ${matches.length ? "matches several nodes" : "matches no node"} — link dropped.`);
  return null;
}

function normalizeLink(link, byLabel, byId, warnings, where) {
  const { from, to, label, oneWay, state, ...rest } = link;
  const source = resolveEnd(link, "sourceId", "from", byLabel, byId, warnings, where);
  const target = resolveEnd(link, "targetId", "to", byLabel, byId, warnings, where);
  if (!source || !target) return null;

  const out = { ...rest, sourceId: source.id, targetId: target.id };
  const isPeek = link.type === "peek";

  if (!out.sourceAnchor || !out.targetAnchor) {
    const [a, b] = isPeek ? peekAnchors(source, target) : navAnchors(source, target);
    out.sourceAnchor ??= a;
    out.targetAnchor ??= b;
  }

  // A link that predates the passages array carries `direction` instead, which the module still
  // reads; leave it alone so an old export keeps meaning what it did.
  if (!isPeek && !out.passages && out.direction === undefined) {
    const passage = { label: label ?? "", direction: oneWay ? "forward" : "both" };
    if (PASSAGE_STATES.includes(state)) passage.state = state;
    else if (state !== undefined) warnings.push(`${where}: link state "${state}" is not open, blocked or secret — left open.`);
    out.passages = [passage];
  }
  return out;
}

/** The nearestAnchor rule: the side facing the other node, horizontal when |dx| ≥ |dy|. */
function navAnchors(a, b) {
  const dx = (b.x ?? 0) - (a.x ?? 0), dy = (b.y ?? 0) - (a.y ?? 0);
  const i = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 1 : 3) : (dy >= 0 ? 2 : 0);
  return [NAV_ANCHORS[i], NAV_ANCHORS[(i + 2) % 4]];
}

/** The corner facing the other node, and the opposite corner on the target. */
function peekAnchors(a, b) {
  const v = (b.y ?? 0) >= (a.y ?? 0) ? "b" : "t";
  const h = (b.x ?? 0) >= (a.x ?? 0) ? "r" : "l";
  const flip = { t: "b", b: "t", l: "r", r: "l" };
  return [`peek-${v}${h}`, `peek-${flip[v]}${flip[h]}`];
}
