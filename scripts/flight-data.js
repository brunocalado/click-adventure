/*!
 * Click Adventure
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * A group's overview map: a Scene the module creates at the map image's size, with no padding and
 * no grid, so image pixels and scene coordinates coincide. Each room is a GM-only Region on it,
 * and the Regions are the only copy of the room geometry — the GM corrects them with the native
 * Region tools, an agent writes them through applyFlightData. A node links to a Region by its
 * explicit `flightRegionId`, or else by a tolerant name match.
 *
 * Polygons stored on the nodes would have been simpler (no overview scene, no coordinate
 * conversion), but then nobody could fix a shape with real tools; keeping node data as the truth
 * with an "edit in Regions" round trip would hold two copies that drift. The overview sits in the
 * group's own scene folder so deleting the group takes it along (Sync Scenes skips it explicitly),
 * and it is deliberately not a node: as one it would link to every room, a teleport that ignores
 * passages, Blocked states and keys.
 *
 * Stored on a group entry: `flight: { enabled, overviewSceneId }`. On a node: `flightRegionId`.
 * Both are optional; absent means "off" and "match by name", so older worlds need no migration.
 */

import { MODULE_ID } from "./constants.js";
import { getActiveGroup } from "./node-utils.js";
import { getOrCreateGroupFolder } from "./manager-scene-ops.js";
import { buildSceneData } from "./scene-template.js";

/** "4. Ballroom", "Ballroom", "ballroom", "3a. Entry" → "ballroom", "entry"; accents and punctuation ignored. */
export function normalizeRoomName(name) {
  return String(name ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/^\s*\d+[a-z]?\s*[.)\-–:]\s*/, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The group's overview scene, or null. A stale id (the scene was deleted) reads as "no overview".
 * @param {object|null} group
 * @returns {Scene|null}
 */
export function getOverviewScene(group) {
  return game.scenes.get(group?.flight?.overviewSceneId) ?? null;
}

/**
 * {src, width, height} for FlightOverlay. Map units are the overview's sceneWidth/sceneHeight, so a
 * later higher-resolution file with the same aspect ratio keeps every polygon aligned.
 * @param {Scene} scene
 */
export function getOverviewMap(scene) {
  const d = scene.dimensions;
  return { src: scene.initialLevel?.background?.src ?? null, width: d.sceneWidth, height: d.sceneHeight };
}

/** Regions on `scene` whose normalized name equals the node's normalized label. */
function regionsMatchingName(node, scene) {
  const key = normalizeRoomName(node?.label);
  if (!key) return [];
  return scene.regions.filter(r => normalizeRoomName(r.name) === key);
}

/**
 * Region for a node: the explicit flightRegionId when it still exists, else the single Region whose
 * normalized name equals the node's normalized label; null when none or ambiguous.
 * @param {object} node
 * @param {Scene} scene
 * @returns {RegionDocument|null}
 */
export function resolveNodeRegion(node, scene) {
  if (!scene) return null;
  const explicit = node?.flightRegionId ? scene.regions.get(node.flightRegionId) : null;
  if (explicit) return explicit;
  const matches = regionsMatchingName(node, scene);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * Outline of a Region in map units: the largest-bbox polygon, flat [x0,y0,…], minus
 * dimensions.sceneX/sceneY. A polygon shape is read as stored, because region.polygons comes back
 * through Clipper with its winding normalised (reversed for some rooms), so reading it back would
 * not return what applyFlightData wrote. Hand-drawn rectangles and ellipses come from
 * region.polygons, where they are already polygons.
 * @param {Scene} scene
 * @param {RegionDocument} region
 * @returns {number[]}
 */
export function regionPoints(scene, region) {
  const candidates = [
    ...region.shapes.filter(s => s.type === "polygon" && !s.hole).map(s => Array.from(s.points)),
    ...(region.shapes.some(s => s.type !== "polygon" && !s.hole) ? (region.polygons ?? []).map(p => Array.from(p.points)) : [])
  ];
  let best = null, bestArea = -1;
  for (const pts of candidates) {
    const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (area > bestArea) { best = pts; bestArea = area; }
  }
  if (!best) return [];
  const { sceneX, sceneY } = scene.dimensions;
  return best.map((v, i) => v - (i % 2 ? sceneY : sceneX));
}

/**
 * Every node of a group with its Region and outline.
 * @param {object} group
 * @returns {{linked: {node: object, region: RegionDocument, points: number[]}[], unlinked: object[],
 *   ambiguous: {node: object, regions: RegionDocument[]}[]}}
 */
export function getFlightRooms(group) {
  const scene = getOverviewScene(group);
  const result = { linked: [], unlinked: [], ambiguous: [] };
  for (const node of group?.nodes ?? []) {
    const region = resolveNodeRegion(node, scene);
    const points = region ? regionPoints(scene, region) : [];
    if (points.length >= 6) result.linked.push({ node, region, points });
    else if (scene && !region && regionsMatchingName(node, scene).length > 1) {
      result.ambiguous.push({ node, regions: regionsMatchingName(node, scene) });
    }
    else result.unlinked.push(node);
  }
  return result;
}

function getGroup(groupId) {
  if (!groupId) return getActiveGroup();
  const col = game.settings.get(MODULE_ID, "graphs").toObject();
  return (col.graphs ?? []).find(g => g.id === groupId) ?? null;
}

/**
 * Merges a patch into one group by id. saveGraphData only reaches the active group, and import
 * applies flight data to a group that is not active.
 */
async function patchGroup(groupId, patch) {
  const col = game.settings.get(MODULE_ID, "graphs").toObject();
  const graphs = (col.graphs ?? []).map(g => g.id === groupId ? { ...g, ...patch } : g);
  await game.settings.set(MODULE_ID, "graphs", { ...col, graphs });
}

async function readImageSize(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return { width: img.naturalWidth, height: img.naturalHeight };
}

/**
 * Creates the group's overview scene in its folder, sized to the map, and turns flight on.
 * GM only. `size` replaces reading the image: an imported overview is rebuilt at the size its
 * polygons were measured in, even when the map file is missing from this world.
 * @param {object} group  any group entry, active or not
 * @param {string} mapSrc
 * @param {{width: number, height: number}} [size]
 * @returns {Promise<Scene>}
 */
export async function createOverviewScene(group, mapSrc, size) {
  const { width, height } = size ?? await readImageSize(mapSrc);
  const folder = await getOrCreateGroupFolder(group);
  const data = buildSceneData(`${group.name} – Overview`);
  Object.assign(data, {
    folder: folder.id, navigation: false, width, height, padding: 0, shiftX: 0, shiftY: 0,
    initial: { x: width / 2, y: height / 2, scale: Math.min(1920 / width, 1080 / height) },
    tiles: [],  // the map is the Level background, not a managed tile
    flags: {}   // NOT isAdventureScene: the HUD must not open on the overview
  });
  data.grid = { ...data.grid, type: CONST.GRID_TYPES.GRIDLESS };
  data.levels = [{ ...data.levels[0], background: { ...data.levels[0].background, src: mapSrc } }];
  const scene = await Scene.create(data);
  await patchGroup(group.id, { flight: { ...(group.flight ?? {}), enabled: true, overviewSceneId: scene.id } });
  return scene;
}

/**
 * Turns a group's flight switch on or off; the overview scene is kept either way.
 * @param {string} groupId
 * @param {boolean} enabled
 * @returns {Promise<void>}
 */
export async function setFlightEnabled(groupId, enabled) {
  await patchGroup(groupId, { flight: { ...(getGroup(groupId)?.flight ?? {}), enabled } });
}

/**
 * Merges `options` into a group's flight entry (pace, and later sound). GM only.
 * @param {string} groupId
 * @param {object} options
 * @returns {Promise<void>}
 */
export async function setFlightOptions(groupId, options) {
  await patchGroup(groupId, { flight: { ...(getGroup(groupId)?.flight ?? {}), ...options } });
}

/**
 * Swaps the overview's map image and keeps the scene size, which is what the Regions are measured
 * in. A different aspect ratio would stretch the new image over the old size and misalign every
 * room, so it warns rather than rescaling anything.
 * @param {object} group
 * @param {string} src
 * @returns {Promise<void>}
 */
export async function changeOverviewMap(group, src) {
  const scene = getOverviewScene(group);
  if (!scene) return;
  const { width, height } = await readImageSize(src);
  const { width: W, height: H } = getOverviewMap(scene);
  if (Math.abs((width / height) / (W / H) - 1) > 0.01) {
    ui.notifications.warn(`Click Adventure: The new map is ${width}×${height}, a different shape from the overview's ${W}×${H}. Its rooms may no longer line up.`);
  }
  await scene.initialLevel.update({ "background.src": src });
}

/** `[[x,y],…]` pairs or a flat array → flat array, or null when the shape is not one of those. */
export function flattenPoints(points) {
  if (!Array.isArray(points)) return null;
  if (points.every(p => Array.isArray(p))) {
    if (!points.every(p => p.length === 2)) return null;
    return points.flat();
  }
  return points;
}

function toScenePoints(scene, points) {
  const { sceneX, sceneY } = scene.dimensions;
  return points.map((v, i) => v + (i % 2 ? sceneY : sceneX));
}

/**
 * Creates or updates the group's overview from room polygons in image pixels — the format an
 * agent writes after looking at the map — and links each room's Region to the node of the same
 * name. Regions are matched by exact name, so running it again updates them in place; Regions the
 * data does not name are left alone.
 *
 * @param {{map?: string, size?: {width: number, height: number},
 *   rooms: {name: string, node?: string, points: number[]|number[][]}[]}} data
 *   `size` (map units) is used instead of reading the image when the overview is created
 * @param {{groupId?: string}} [options]  defaults to the active group
 * @returns {Promise<object>} a report of what was created, updated, linked and rejected
 */
export async function applyFlightData(data, { groupId } = {}) {
  if (!game.user.isGM) throw new Error("Click Adventure | Only a GM can apply flight data.");
  let group = getGroup(groupId);
  if (!group) throw new Error("Click Adventure | No such group.");
  if (!Array.isArray(data?.rooms)) throw new Error("Click Adventure | Flight data needs a \"rooms\" array.");

  const report = {
    overviewSceneId: null, mapIgnored: false, created: [], updated: [], linked: [],
    unmatchedRooms: [], nodesWithoutRoom: [], ambiguous: [], rejected: [], warnings: []
  };

  let scene = getOverviewScene(group);
  if (!scene) {
    if (typeof data.map !== "string" || !data.map) {
      throw new Error("Click Adventure | The group has no overview yet, so flight data needs a \"map\" path.");
    }
    const { width, height } = data.size ?? {};
    const size = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
      ? { width, height } : null;
    if (size) {
      try { await readImageSize(data.map); }
      catch { report.warnings.push(`The map image "${data.map}" could not be loaded; the overview was created at ${width}×${height} without it.`); }
    }
    scene = await createOverviewScene(group, data.map, size);
    group = getGroup(group.id);
  } else if (data.map && data.map !== getOverviewMap(scene).src) {
    report.mapIgnored = true;
  }
  report.overviewSceneId = scene.id;
  const { width: W, height: H } = getOverviewMap(scene);

  // Validate every room before touching the scene: the input is hand-written or agent-written.
  const rooms = [];
  const names = new Set();
  for (const room of data.rooms) {
    const name = typeof room?.name === "string" ? room.name.trim() : "";
    const label = name || String(room?.name ?? "");
    if (!name) { report.rejected.push({ room: label, reason: "empty name" }); continue; }
    if (names.has(name)) { report.rejected.push({ room: name, reason: "duplicate name" }); continue; }
    const points = flattenPoints(room.points);
    if (!points || points.length % 2) { report.rejected.push({ room: name, reason: "points are not [x, y] pairs" }); continue; }
    if (points.length < 6) { report.rejected.push({ room: name, reason: "fewer than 3 points" }); continue; }
    if (!points.every(Number.isFinite)) { report.rejected.push({ room: name, reason: "a coordinate is not a finite number" }); continue; }
    if (points.some((v, i) => v < 0 || v > (i % 2 ? H : W))) {
      report.warnings.push(`${name}: a point lies outside the ${W}×${H} map`);
    }
    names.add(name);
    rooms.push({ name, node: typeof room.node === "string" ? room.node : null, points });
  }

  // Upsert, one batched call per kind. Identity is the exact Region name (the agent controls names).
  const existing = new Map();
  for (const r of scene.regions) if (!existing.has(r.name)) existing.set(r.name, r);
  const toCreate = rooms.filter(r => !existing.has(r.name));
  const toUpdate = rooms.filter(r => existing.has(r.name));
  const shapeOf = r => [{ type: "polygon", points: toScenePoints(scene, r.points), hole: false }];
  const created = toCreate.length ? await scene.createEmbeddedDocuments("Region", toCreate.map(r => ({
    name: r.name,
    shapes: shapeOf(r),
    visibility: CONST.REGION_VISIBILITY.GAMEMASTER,
    levels: [scene.initialLevel.id]
  }))) : [];
  // Colour, visibility and name edited by hand are kept: only the shape is replaced.
  if (toUpdate.length) {
    await scene.updateEmbeddedDocuments("Region", toUpdate.map(r => ({ _id: existing.get(r.name).id, shapes: shapeOf(r) })));
  }
  report.created = toCreate.map(r => r.name);
  report.updated = toUpdate.map(r => r.name);
  const regionIds = new Map([
    ...toUpdate.map(r => [r.name, existing.get(r.name).id]),
    ...created.map(r => [r.name, r.id])
  ]);

  // Link: the explicit node label (exact, then normalized), else the room's own name normalized.
  const nodes = (group.nodes ?? []).map(n => ({ ...n }));
  for (const room of rooms) {
    let matches = [];
    if (room.node) {
      matches = nodes.filter(n => n.label === room.node);
      if (!matches.length) matches = nodes.filter(n => normalizeRoomName(n.label) === normalizeRoomName(room.node));
    } else {
      const key = normalizeRoomName(room.name);
      matches = key ? nodes.filter(n => normalizeRoomName(n.label) === key) : [];
    }
    if (matches.length === 1) {
      matches[0].flightRegionId = regionIds.get(room.name);
      report.linked.push({ room: room.name, node: matches[0].label });
    } else if (matches.length > 1) {
      report.ambiguous.push({ room: room.name, nodes: matches.map(n => n.label) });
    } else {
      report.unmatchedRooms.push(room.name);
    }
  }
  report.nodesWithoutRoom = nodes.filter(n => !resolveNodeRegion(n, scene)).map(n => n.label);
  await patchGroup(group.id, { nodes });

  console.info("Click Adventure | Flight data applied:", report);
  return report;
}

/**
 * The group's overview setup in map units, in the same shape applyFlightData takes, so an agent
 * can check its work.
 * @param {{groupId?: string}} [options]  defaults to the active group
 */
export function readFlightData({ groupId } = {}) {
  const group = getGroup(groupId);
  const scene = getOverviewScene(group);
  const nodes = group?.nodes ?? [];
  const pairs = flat => Array.from({ length: flat.length / 2 }, (_, i) => [flat[2 * i], flat[2 * i + 1]]);
  const regionOf = new Map(nodes.map(n => [n.id, resolveNodeRegion(n, scene)]));
  return {
    group: group?.name ?? null,
    overviewSceneId: scene?.id ?? null,
    map: scene ? getOverviewMap(scene) : null,
    rooms: scene ? scene.regions.map(region => ({
      name: region.name,
      regionId: region.id,
      node: nodes.find(n => regionOf.get(n.id)?.id === region.id)?.label ?? null,
      points: pairs(regionPoints(scene, region))
    })) : [],
    nodes: nodes.map(n => ({ id: n.id, label: n.label, room: regionOf.get(n.id)?.name ?? null }))
  };
}
