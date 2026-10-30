/*!
 * Click Adventure
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Updates a module-shipped group in place from a newer version of the module's file. One rule
 * decides every field: an updated node is the node a fresh import of the file would produce, with
 * the world's scene, Manager position and play state copied onto it. Same for links. So the
 * file's content wins, and scene ids, whatever the GM placed on those scenes, positions, opened
 * doors and fired macros are kept.
 *
 * GM edits to module content are overwritten. Keeping them would need a three-way merge against
 * a stored copy of the last applied file: a module's file mentions every content field, so a
 * two-way comparison cannot tell "the GM changed it" from "the author changed it". Letting keys
 * missing from the file keep the world's value looks like it preserves GM edits, but a module's
 * file is complete, so it behaves the same while making a hand-written file ambiguous
 * (`nodeMacros` absent or `[]`). A Replace that reused scene ids was cheaper, but it would still
 * reset doors and macros and drop the GM's nodes.
 *
 * Nodes and links leave only when the module's previous file had them (`group.source`), so
 * nodes the GM added survive. A group with no `source` removes nothing.
 */

import { MODULE_ID } from "./constants.js";
import { processNode, flightWarnings, linkKey, adventureSource } from "./adventure-import.js";
import { normalizeImportGraph } from "./import-normalize.js";
import { getOrCreateGroupFolder, createSceneForNode } from "./manager-scene-ops.js";
import { syncNodeTile } from "./node-utils.js";
import { getNodeJournal, getNodeMusic } from "./node-media.js";
import {
  applyFlightData, changeOverviewMap, setFlightEnabled, setFlightOptions,
  getOverviewScene, getOverviewMap, regionPoints, flattenPoints
} from "./flight-data.js";

/** Node fields that come from the world, not the file; they never count as a content change. */
const WORLD_FIELDS = new Set([
  "id", "sceneId", "x", "y", "activeImageIndex", "flightRegionId", "activeLinkedSceneId",
  "pendingJournal", "pendingMusic"
]);

function readCollection() {
  const col = game.settings.get(MODULE_ID, "graphs");
  return typeof col?.toObject === "function" ? col.toObject() : (col ?? {});
}

function readGroup(groupId) {
  return (readCollection().graphs ?? []).find(g => g.id === groupId) ?? null;
}

/**
 * @typedef {object} UpdatePlan
 * @property {string} groupId
 * @property {object} fresh          normalized + processed file graph (pendingJournal/pendingMusic on nodes)
 * @property {object} source         the group's `source` once the update is applied
 * @property {{added: string[], changed: {label: string, fields: string[]}[], removed: string[], keptByGm: string[]}} nodes
 * @property {string[]} removedNodeIds
 * @property {{added: number, changed: number, removed: number}} links
 * @property {{created: string[], updated: string[], mapChanged: boolean}} rooms
 * @property {string[]} group        group-level settings that change: name, start node, flight pace, flight sound, flight room name
 * @property {string[]} warnings     unresolved macros/journals/tracks, plus "no source: nothing removed"
 * @property {boolean} empty         true when nothing would change
 */

/**
 * The merged group and a summary of what changes, without writing anything.
 * Async only because macro references resolve through fromUuid; resolution is read-only.
 * @param {object} fileGraph  one entry of the module file's `graphs`
 * @param {{module: Module, path: string}} origin
 * @returns {Promise<UpdatePlan>}
 */
export async function planUpdate(fileGraph, origin) {
  const world = readGroup(fileGraph?.id);
  if (!world) throw new Error(`Click Adventure | No group "${fileGraph?.id}" in this world to update.`);
  const warnings = [];

  // A node the file writes without an id keeps the world node's id when its label names exactly
  // one; normalizeImportGraph would otherwise give it a random id, and it would read as new.
  const graph = foundry.utils.deepClone(fileGraph);
  const fileIds = new Set((graph.nodes ?? []).map(n => n.id).filter(Boolean));
  for (const node of (graph.nodes ?? [])) {
    if (node.id) continue;
    const matches = (world.nodes ?? []).filter(n => n.label === node.label && !fileIds.has(n.id));
    if (matches.length === 1) {
      node.id = matches[0].id;
      fileIds.add(node.id);
    }
  }

  const normalized = normalizeImportGraph(graph, warnings);
  const nodes = [];
  for (const node of normalized.nodes) nodes.push(await processNode(node, warnings));
  const fresh = { ...normalized, nodes };

  const merged = merge(world, fresh, {});
  const worldById = new Map((world.nodes ?? []).map(n => [n.id, n]));
  const mergedById = new Map(merged.group.nodes.map(n => [n.id, n]));

  const changed = [];
  for (const f of fresh.nodes) {
    const w = worldById.get(f.id);
    if (!w) continue;
    const m = mergedById.get(f.id);
    const fields = [...new Set([...Object.keys(m), ...Object.keys(w)])]
      .filter(k => !WORLD_FIELDS.has(k) && !foundry.utils.equals(m[k] ?? null, w[k] ?? null));
    const { journal, page } = getNodeJournal(w);
    if ((journal?.id ?? null) !== (f.pendingJournal?.journalId ?? null) || (page?.id ?? null) !== (f.pendingJournal?.pageId ?? null)) {
      fields.push("journal");
    }
    const { playlist, sound } = getNodeMusic(w);
    if ((playlist?.id ?? null) !== (f.pendingMusic?.playlistId ?? null) || (sound?.id ?? null) !== (f.pendingMusic?.soundId ?? null)) {
      fields.push("music");
    }
    if (fields.length) changed.push({ label: f.label, fields });
  }

  const group = [];
  if (fresh.name !== world.name) group.push("name");
  if ((fresh.startNodeId ?? "") !== (world.startNodeId ?? "")) group.push("start node");
  if (fresh.flight) {
    const pace = ["slow", "normal", "fast"].includes(fresh.flight.pace) ? fresh.flight.pace : null;
    if (pace && pace !== (world.flight?.pace ?? "normal")) group.push("flight pace");
    const sound = typeof fresh.flight.sound?.src === "string" ? fresh.flight.sound : null;
    if (sound && !foundry.utils.equals(sound, world.flight?.sound ?? null)) group.push("flight sound");
    if (typeof fresh.flight.caption === "boolean" && fresh.flight.caption !== (world.flight?.caption !== false)) {
      group.push("flight room name");
    }
  }

  const rooms = planRooms(world, fresh.flight);

  if (!world.source) {
    warnings.push(`Group "${world.name}" has no record of the module file it came from, so nothing is removed: nodes and links the file no longer has are kept.`);
  }

  const plan = {
    groupId: world.id,
    fresh,
    source: adventureSource(origin, fresh),
    nodes: {
      added:    fresh.nodes.filter(n => !worldById.has(n.id)).map(n => n.label),
      changed,
      removed:  merged.removedNodes.map(n => n.label),
      keptByGm: merged.keptByGm.map(n => n.label)
    },
    removedNodeIds: merged.removedNodes.map(n => n.id),
    links: merged.links,
    rooms,
    group,
    warnings
  };
  plan.empty = !plan.nodes.added.length && !changed.length && !plan.nodes.removed.length
    && !plan.links.added && !plan.links.changed && !plan.links.removed
    && !rooms.created.length && !rooms.updated.length && !rooms.mapChanged && !group.length;
  return plan;
}

/**
 * Which overview rooms the file creates or reshapes, and whether it swaps the map.
 * @param {object} world
 * @param {object|undefined} flight  the file's flight block
 * @returns {{created: string[], updated: string[], mapChanged: boolean}}
 */
function planRooms(world, flight) {
  const result = { created: [], updated: [], mapChanged: false };
  if (!flight) return result;
  const overview = getOverviewScene(world);
  const names = (flight.rooms ?? [])
    .map(r => ({ name: typeof r?.name === "string" ? r.name.trim() : "", points: flattenPoints(r?.points) }))
    .filter(r => r.name);
  if (!overview) {
    result.created = names.map(r => r.name);
    result.mapChanged = typeof flight.map === "string" && !!flight.map;
    return result;
  }
  result.mapChanged = !!flight.map && flight.map !== getOverviewMap(overview).src;
  const existing = new Map();
  for (const r of overview.regions) if (!existing.has(r.name)) existing.set(r.name, r);
  for (const room of names) {
    const region = existing.get(room.name);
    if (!region) result.created.push(room.name);
    else if (!foundry.utils.equals(regionPoints(overview, region), room.points)) result.updated.push(room.name);
  }
  return result;
}

/**
 * The world group with the file applied. Pure: called once by planUpdate for the preview, and
 * again by applyUpdate on a fresh read right before writing.
 * @param {object} world
 * @param {object} fresh
 * @param {Record<string, string>} sceneIds  scene ids already created for the file's new nodes
 * @returns {{group: object, removedNodes: object[], keptByGm: object[], links: {added: number, changed: number, removed: number}}}
 */
function merge(world, fresh, sceneIds) {
  const source = world.source ?? null;
  const worldNodes = world.nodes ?? [];
  const worldById = new Map(worldNodes.map(n => [n.id, n]));
  const freshIds = new Set(fresh.nodes.map(n => n.id));
  const shipped = new Set(source?.nodeIds ?? []);
  const removedNodes = worldNodes.filter(n => !freshIds.has(n.id) && shipped.has(n.id));
  const keptByGm = worldNodes.filter(n => !freshIds.has(n.id) && !shipped.has(n.id));
  const removedIds = new Set(removedNodes.map(n => n.id));

  const nodes = fresh.nodes.map(f => {
    const w = worldById.get(f.id);
    if (w) return mergeNode(w, f);
    const sceneId = sceneIds[f.id] ?? null;
    return sceneId ? { ...f, sceneId, pendingJournal: null, pendingMusic: null } : f;
  });

  // Links pair up in file order by key, so two links between the same nodes stay two.
  const queues = new Map();
  for (const l of (world.links ?? [])) {
    const key = linkKey(l);
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(l);
  }
  const matched = new Set();
  const links = [];
  const counts = { added: 0, changed: 0, removed: 0 };
  for (const f of (fresh.links ?? [])) {
    const w = queues.get(linkKey(f))?.shift();
    if (!w) { counts.added++; links.push(f); continue; }
    matched.add(w);
    const m = mergeLink(w, f);
    if (!foundry.utils.equals(m, w)) counts.changed++;
    links.push(m);
  }
  const shippedLinks = new Set(source?.linkKeys ?? []);
  for (const w of (world.links ?? [])) {
    if (matched.has(w)) continue;
    if (removedIds.has(w.sourceId) || removedIds.has(w.targetId) || shippedLinks.has(linkKey(w))) counts.removed++;
    else links.push(w);
  }

  return {
    group: { ...world, name: fresh.name, startNodeId: fresh.startNodeId ?? "", nodes: [...nodes, ...keptByGm], links },
    removedNodes,
    keptByGm,
    links: counts
  };
}

/**
 * The file's node with the world's scene, position and play state on it.
 * @param {object} w  world node
 * @param {object} f  processed file node
 * @returns {object}
 */
function mergeNode(w, f) {
  // Image ids follow the src, so an id something holds on to survives a reordered list.
  const used = new Set();
  const images = (f.images ?? []).map(img => {
    const same = (w.images ?? []).find(i => i.src === img.src && i.id && !used.has(i.id));
    if (!same) return img;
    used.add(same.id);
    return { ...img, id: same.id };
  });
  const activeSrc = w.images?.[w.activeImageIndex ?? 0]?.src;
  const activeImageIndex = Math.max(images.findIndex(i => i.src === activeSrc), 0);

  const nodeMacros = (f.nodeMacros ?? []).map(m => ({
    ...m,
    executedOnce: (w.nodeMacros ?? []).find(x => x.macroId === m.macroId && x.trigger === m.trigger)?.executedOnce === true
  }));

  // With a scene, journal and music live on it and applyUpdate writes them there; without one
  // they stay staged on the node until a scene is created.
  const hasScene = !!w.sceneId;
  const out = {
    ...f, images, nodeMacros, activeImageIndex,
    sceneId: w.sceneId ?? null,
    x: w.x, y: w.y,
    pendingJournal: hasScene ? null : (f.pendingJournal ?? null),
    pendingMusic:   hasScene ? null : (f.pendingMusic ?? null)
  };
  if (w.flightRegionId !== undefined) out.flightRegionId = w.flightRegionId;
  if (w.activeLinkedSceneId && out.linkedScenes?.some(ls => ls.id === w.activeLinkedSceneId)) {
    out.activeLinkedSceneId = w.activeLinkedSceneId;
  }
  return out;
}

/**
 * The file's link with the world's anchors and each passage's state.
 * @param {object} w  world link
 * @param {object} f  normalized file link
 * @returns {object}
 */
function mergeLink(w, f) {
  // A navigation link written the other way round keeps each anchor on the node it was on.
  const swapped = f.sourceId !== w.sourceId;
  const out = { ...f };
  const sourceAnchor = swapped ? w.targetAnchor : w.sourceAnchor;
  const targetAnchor = swapped ? w.sourceAnchor : w.targetAnchor;
  if (sourceAnchor !== undefined) out.sourceAnchor = sourceAnchor;
  if (targetAnchor !== undefined) out.targetAnchor = targetAnchor;
  if (Array.isArray(f.passages)) {
    out.passages = f.passages.map((p, i) => {
      const state = w.passages?.[i]?.state;
      return state === undefined ? p : { ...p, state };
    });
  }
  return out;
}

/**
 * Applies a plan made by planUpdate. GM only. An empty plan only records the module's version.
 * @param {UpdatePlan} plan
 * @returns {Promise<void>}
 */
export async function applyUpdate(plan) {
  if (!game.user.isGM) throw new Error("Click Adventure | Only a GM can update an adventure.");
  const { groupId, fresh } = plan;
  let world = readGroup(groupId);
  if (!world) throw new Error(`Click Adventure | No group "${groupId}" in this world to update.`);

  if (plan.empty) {
    if (!foundry.utils.equals(world.source ?? null, plan.source)) await writeGroup({ ...world, source: plan.source });
    ui.notifications.info(`Click Adventure: "${world.name}" is already up to date.`);
    return;
  }

  ui.notifications.info("Click Adventure: Update started…");
  const warnings = [...plan.warnings];

  // 1. Scenes for the file's new nodes. A failure stops here with nothing else written, like an
  //    import; the scenes already created are left in the folder.
  const worldById = new Map((world.nodes ?? []).map(n => [n.id, n]));
  const folder = await getOrCreateGroupFolder(world);
  const sceneIds = {};
  try {
    for (const f of fresh.nodes) {
      if (!worldById.has(f.id)) sceneIds[f.id] = await createSceneForNode(f, folder.id);
    }
  } catch (err) {
    ui.notifications.error(`Click Adventure: "${world.name}" was not updated (${err.message}). Scenes it had already created are left in its folder; Sync Scenes removes them.`);
    return;
  }

  // 2. Existing scenes are updated in place, so their ids and what the GM placed on them stay.
  for (const f of fresh.nodes) {
    const w = worldById.get(f.id);
    const scene = w ? game.scenes.get(w.sceneId) : null;
    if (!scene) continue;
    const node = mergeNode(w, f);
    const activeImage = node.images[node.activeImageIndex] ?? node.images[0] ?? null;
    const { journal, page } = getNodeJournal(w);
    const { playlist, sound } = getNodeMusic(w);
    const current = {
      name: scene.name, navName: scene.navName ?? "",
      journal: journal?.id ?? null, journalEntryPage: page?.id ?? null,
      playlist: playlist?.id ?? null, playlistSound: sound?.id ?? null
    };
    const wanted = {
      name: node.label || "Scene", navName: activeImage?.label?.trim() || "",
      journal: f.pendingJournal?.journalId ?? null, journalEntryPage: f.pendingJournal?.pageId ?? null,
      playlist: f.pendingMusic?.playlistId ?? null, playlistSound: f.pendingMusic?.soundId ?? null
    };
    const update = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => current[k] !== v));
    if (Object.keys(update).length) await scene.update(update);
    await syncNodeTile(node);
  }

  // 3. Read again right before writing: scene work awaits, and a Manager drag, a door opened or a
  //    macro fired meanwhile must not be overwritten.
  world = readGroup(groupId);
  const merged = merge(world, fresh, sceneIds);
  await writeGroup({ ...merged.group, source: plan.source });
  const folderName = `Click Adventure — ${merged.group.name}`;
  if (folder.name !== folderName) await folder.update({ name: folderName });

  // 4. Overview. applyFlightData reads the group written above and turns flight on when it
  //    creates the overview; on an overview that already existed the GM's switch is kept.
  if (fresh.flight) {
    const flight = fresh.flight;
    const overview = getOverviewScene(world);
    if (overview && flight.map && flight.map !== getOverviewMap(overview).src) {
      try { await changeOverviewMap(world, flight.map); }
      catch (err) { warnings.push(`Group "${fresh.name}" / overview map: the map "${flight.map}" could not be loaded (${err.message ?? err}); the old one is kept.`); }
    }
    try {
      const report = await applyFlightData(
        { map: flight.map, size: flight.size, rooms: flight.rooms ?? [] },
        { groupId }
      );
      if (overview) await setFlightEnabled(groupId, world.flight?.enabled === true);
      else if (flight.enabled === false) await setFlightEnabled(groupId, false);
      const options = {};
      if (["slow", "normal", "fast"].includes(flight.pace)) options.pace = flight.pace;
      if (typeof flight.sound?.src === "string") options.sound = flight.sound;
      if (typeof flight.caption === "boolean") options.caption = flight.caption;
      if (Object.keys(options).length) await setFlightOptions(groupId, options);
      warnings.push(...flightWarnings(fresh.name, report));
    } catch (err) {
      warnings.push(`Group "${fresh.name}" / overview map: ${err.message}`);
    }
  }

  // 5. Removed nodes go last, once nothing points at their scenes. Players standing on one are
  //    cleared, as a reset does.
  const stale = merged.removedNodes.map(n => n.sceneId).filter(id => id && game.scenes.has(id));
  if (stale.length) await Scene.deleteDocuments(stale);
  const removedIds = new Set(merged.removedNodes.map(n => n.id));
  const userUpdates = game.users
    .filter(u => removedIds.has(u.getFlag(MODULE_ID, "currentNodeId")))
    .map(u => ({ _id: u.id, flags: { [MODULE_ID]: { currentNodeId: null } } }));
  if (userUpdates.length) await User.updateDocuments(userUpdates);

  if (warnings.length) {
    ui.notifications.warn(`Click Adventure: Updated "${fresh.name}" with ${warnings.length} warning(s) — see browser console.`);
    warnings.forEach(w => console.warn(`Click Adventure | Update: ${w}`));
  } else {
    ui.notifications.info(`Click Adventure: Updated "${fresh.name}".`);
  }

  const manager = foundry.applications.instances.get("manager-app");
  if (manager?.rendered) manager.render({ force: true });
}

/** Replaces one group entry in the collection, from a fresh read. */
async function writeGroup(entry) {
  const raw = readCollection();
  const graphs = (raw.graphs ?? []).map(g => g.id === entry.id ? entry : g);
  await game.settings.set(MODULE_ID, "graphs", { ...raw, graphs });
}
