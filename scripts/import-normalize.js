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
