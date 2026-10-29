/*!
 * Click Adventure
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * The adventure import pipeline: resolves the references in an import file against this world,
 * creates a Scene for every node and writes the groups to the world collection. Lives apart from
 * the Export / Import window so anything that applies an adventure file can reuse node processing
 * without an app instance.
 */

import { MODULE_ID } from "./constants.js";
import { getGroupFolder, getOrCreateGroupFolder, createSceneForNode } from "./manager-scene-ops.js";
import { normalizeImportGraph } from "./import-normalize.js";
import { applyFlightData, setFlightEnabled, setFlightOptions } from "./flight-data.js";

/**
 * Processes and persists selected graphs from the import payload.
 * For each graph:
 *   0. Fills in what a hand-written file leaves out (normalizeImportGraph).
 *   1. Resolves all macro references (UUID → world ID → name fallback).
 *   2. Resolves linked-scene references by scene name.
 *   3. Resolves journal and music references (id → name) into the node's staging fields.
 *   4. Creates a Foundry Scene for every node in the graph's own Scene folder, which is
 *      where the staged journal and music land; the staging fields are then cleared.
 *   5. Writes the graph to the world collection: appended with a fresh ID, or with
 *      `keepIds`, under the file's own ID, replacing a group that already has it.
 *
 * @param {object[]} graphs - graph objects from the import JSON
 * @param {{keepIds?: boolean}} [options]  keepIds: the group takes the file's own id, and an
 *   existing group with that id is replaced in place (same position in the list, same folder).
 * @returns {Promise<void>}
 */
export async function importGraphs(graphs, { keepIds = false } = {}) {
  ui.notifications.info("Click Adventure: Import started — creating scenes…");

  const warnings = [];
  const readGraphs = () => {
    const col = game.settings.get(MODULE_ID, "graphs");
    return typeof col?.toObject === "function" ? col.toObject() : (col ?? {});
  };
  const startGraphs = readGraphs().graphs ?? [];
  /** @type {{graph: object, entry: object, oldSceneIds: string[]}[]} */
  const imported = [];

  for (let graph of graphs) {
    // A hand-written file may leave out ids, anchors, passages and positions; from here on the
    // import only sees the export shape.
    graph = normalizeImportGraph(graph, warnings);
    if (keepIds && (typeof graph.id !== "string" || !graph.id)) {
      warnings.push(`Group "${graph.name}" has no id in the file — skipped.`);
      continue;
    }
    const groupId   = keepIds ? graph.id : foundry.utils.randomID();
    const replacing = keepIds && startGraphs.some(g => g.id === groupId);

    // Captured before anything is created, so the new scenes are never among them.
    const oldFolder   = replacing ? getGroupFolder({ id: groupId }) : null;
    const oldSceneIds = oldFolder ? game.scenes.filter(s => s.folder?.id === oldFolder.id).map(s => s.id) : [];

    const processedNodes = [];
    for (const node of (graph.nodes ?? [])) {
      const processed = await processNode(node, warnings);
      processedNodes.push(processed);
    }

    // Each imported graph gets its own Scene folder, keyed by its id — the same folder on a replace.
    const graphFolder = await getOrCreateGroupFolder({ id: groupId, name: graph.name });

    // Create Foundry Scenes immediately — no manual "Sync Scenes" step needed. A failure leaves the
    // group as it was: the entry is only written once every scene exists.
    try {
      for (let i = 0; i < processedNodes.length; i++) {
        const sceneId = await createSceneForNode(processedNodes[i], graphFolder.id);
        processedNodes[i] = {
          ...processedNodes[i],
          sceneId,
          pendingJournal: null,
          pendingMusic: null
        };
      }
    } catch (err) {
      warnings.push(replacing
        ? `Group "${graph.name}" was not replaced (${err.message}); it is unchanged. Scenes the import had already created are left in its folder; Sync Scenes removes them.`
        : `Group "${graph.name}" was not imported (${err.message}). Scenes it had already created are left in the folder "${graphFolder.name}"; delete that folder to remove them.`);
      continue;
    }

    const folderName = `Click Adventure — ${graph.name}`;
    if (graphFolder.name !== folderName) await graphFolder.update({ name: folderName });

    imported.push({
      graph,
      oldSceneIds,
      entry: {
        id:          groupId,
        name:        graph.name,
        startNodeId: graph.startNodeId ?? "",
        nodes:       processedNodes,
        links:       graph.links ?? []
      }
    });
  }

  // Read again right before writing: scene creation awaits, and anything saved meanwhile — a
  // Manager drag, a Node Configuration save, an executedOnce mark — must not be overwritten.
  const raw = readGraphs();
  const finalGraphs = [...(raw.graphs ?? [])];
  let { activeGraphId } = raw;
  for (const { entry } of imported) {
    const index = finalGraphs.findIndex(g => g.id === entry.id);
    if (index >= 0) finalGraphs[index] = entry;
    else finalGraphs.push(entry);
    // Activate the first imported graph if the world has none yet.
    if (!activeGraphId) activeGraphId = entry.id;
  }
  if (imported.length) await game.settings.set(MODULE_ID, "graphs", { ...raw, activeGraphId, graphs: finalGraphs });

  // Overview maps go last: applyFlightData reads and patches the groups written just above.
  for (const { graph, entry } of imported) {
    if (!graph.flight) continue;
    const groupId = entry.id;
    try {
      const report = await applyFlightData(
        { map: graph.flight.map, size: graph.flight.size, rooms: graph.flight.rooms ?? [] },
        { groupId }
      );
      // apply() turns flight on; honour the exported switch.
      if (graph.flight.enabled === false) await setFlightEnabled(groupId, false);
      // An older export has no pace or sound: the group reads as Normal and silent. A sound path is
      // kept even if the file is missing here; the flight then plays silent with a warning.
      const options = {};
      if (["slow", "normal", "fast"].includes(graph.flight.pace)) options.pace = graph.flight.pace;
      if (typeof graph.flight.sound?.src === "string") options.sound = graph.flight.sound;
      if (Object.keys(options).length) await setFlightOptions(groupId, options);
      warnings.push(...flightWarnings(graph.name, report));
    } catch (err) {
      warnings.push(`Group "${graph.name}" / overview map: ${err.message}`);
    }
  }

  // The replaced group's old scenes go only now that the new ones are written. Players keep their
  // position when the file still has their node; the others are cleared, as a reset does.
  for (const { entry, oldSceneIds } of imported) {
    if (!oldSceneIds.length) continue;
    const stale = oldSceneIds.filter(id => game.scenes.has(id));
    if (stale.length) await Scene.deleteDocuments(stale);
  }
  const replacedIds = new Set(imported.filter(i => i.oldSceneIds.length).map(i => i.entry.id));
  if (replacedIds.size) {
    const oldNodeIds = new Set(startGraphs.filter(g => replacedIds.has(g.id)).flatMap(g => (g.nodes ?? []).map(n => n.id)));
    const newNodeIds = new Set(imported.flatMap(i => i.entry.nodes.map(n => n.id)));
    const userUpdates = game.users
      .filter(u => {
        const nodeId = u.getFlag(MODULE_ID, "currentNodeId");
        return oldNodeIds.has(nodeId) && !newNodeIds.has(nodeId);
      })
      .map(u => ({ _id: u.id, flags: { [MODULE_ID]: { currentNodeId: null } } }));
    if (userUpdates.length) await User.updateDocuments(userUpdates);
  }

  if (warnings.length > 0) {
    ui.notifications.warn(
      `Click Adventure: Import complete with ${warnings.length} warning(s) — see browser console.`
    );
    warnings.forEach(w => console.warn(`Click Adventure | Import: ${w}`));
  } else {
    ui.notifications.info(
      `Click Adventure: Imported ${imported.length} group(s) successfully.`
    );
  }

  const manager = foundry.applications.instances.get("manager-app");
  if (manager?.rendered) manager.render({ force: true });
}

/**
 * Turns an applyFlightData report into import warnings: what the new group's overview could
 * not carry over.
 * @param {string} groupName
 * @param {object} report
 * @returns {string[]}
 */
export function flightWarnings(groupName, report) {
  const prefix = `Group "${groupName}" / overview map`;
  return [
    ...report.warnings.map(w => `${prefix}: ${w}`),
    ...report.rejected.map(r => `${prefix}: room "${r.room}" skipped (${r.reason})`),
    ...report.unmatchedRooms.map(r => `${prefix}: room "${r}" is linked to no node`)
  ];
}

/**
 * Resolves all external references (macros, linked scenes) within a node
 * and returns a clean copy ready for persistence.
 *
 * @param {object}   node     - raw node from the import JSON
 * @param {string[]} warnings - mutable array; push human-readable warnings here
 * @returns {Promise<object>}
 */
export async function processNode(node, warnings) {
  const images = [];
  for (const img of (node.images ?? [])) {
    let macro = null;
    if (img.macro) {
      const id = await resolveMacroId(
        img.macro.macroId, img.macro.macroName,
        warnings, `Node "${node.label}" / image "${img.label}"`
      );
      macro = id ? { ...img.macro, macroId: id } : null;
    }
    images.push({ ...img, macro });
  }

  const linkedScenes = [];
  for (const ls of (node.linkedScenes ?? [])) {
    const scene = ls.sceneName
      ? (game.scenes.find(s => s.name === ls.sceneName) ?? null)
      : null;
    if (ls.sceneName && !scene) {
      warnings.push(
        `Node "${node.label}": linked scene "${ls.sceneName}" not found — reference cleared.`
      );
    }
    let macro = null;
    if (ls.macro) {
      const id = await resolveMacroId(
        ls.macro.macroId, ls.macro.macroName,
        warnings, `Node "${node.label}" / linked scene "${ls.label}"`
      );
      macro = id ? { ...ls.macro, macroId: id } : null;
    }
    linkedScenes.push({ ...ls, sceneId: scene?.id ?? null, macro });
  }

  const nodeMacros = [];
  for (const nm of (node.nodeMacros ?? [])) {
    const id = await resolveMacroId(
      nm.macroId, nm.macroName,
      warnings, `Node "${node.label}" / node macro`
    );
    if (id) nodeMacros.push({ ...nm, macroId: id, executedOnce: false });
  }

  // The export keys are the *references*; what gets persisted are the node's staging
  // fields, so pull them out of the spread rather than leaving strays on the node.
  const { journal: journalRef, music: musicRef, ...rest } = node;
  const pendingJournal = resolveJournalRef(journalRef, warnings, `Node "${node.label}"`);
  const pendingMusic   = resolveMusicRef(musicRef, warnings, `Node "${node.label}"`);

  return { ...rest, sceneId: null, images, linkedScenes, nodeMacros, pendingJournal, pendingMusic };
}

/**
 * Resolves an exported journal reference against this world.
 *
 * Resolution order, same shape as {@link resolveMacroId}:
 *   1. `game.journal.get(journalId)`  — exact, for a re-import into the source world
 *   2. `game.journal.getName(name)`   — name fallback, for any other world
 *
 * A found entry whose page is missing is kept without the page rather than dropped:
 * the whole entry opening is closer to the author's intent than nothing opening.
 *
 * @param {object|null} ref      - the exported reference
 * @param {string[]}    warnings - mutable array; push human-readable warnings here
 * @param {string}      context  - prefix identifying the node in a warning
 * @returns {{journalId: string, pageId: string|null}|null}
 */
export function resolveJournalRef(ref, warnings, context) {
  if (!ref?.journalId && !ref?.journalName) return null;

  const entry = (ref.journalId ? game.journal.get(ref.journalId) : null)
    ?? (ref.journalName ? game.journal.getName(ref.journalName) : null);

  if (!entry) {
    warnings.push(`${context}: journal "${ref.journalName ?? ref.journalId}" not found — reference cleared.`);
    return null;
  }

  if (!ref.pageId && !ref.pageName) return { journalId: entry.id, pageId: null };

  const page = (ref.pageId ? entry.pages.get(ref.pageId) : null)
    ?? (ref.pageName ? entry.pages.find(p => p.name === ref.pageName) : null);

  if (!page) {
    warnings.push(
      `${context}: page "${ref.pageName ?? ref.pageId}" not found in journal "${entry.name}" — the whole entry will open instead.`
    );
    return { journalId: entry.id, pageId: null };
  }

  return { journalId: entry.id, pageId: page.id };
}

/**
 * Resolves an exported music reference against this world, same order and same
 * partial-match tolerance as {@link resolveJournalRef}: a playlist found without its
 * track is kept, and Foundry falls back to the playlist's own playback mode.
 *
 * @param {object|null} ref      - the exported reference
 * @param {string[]}    warnings - mutable array; push human-readable warnings here
 * @param {string}      context  - prefix identifying the node in a warning
 * @returns {{playlistId: string, soundId: string|null}|null}
 */
export function resolveMusicRef(ref, warnings, context) {
  if (!ref?.playlistId && !ref?.playlistName) return null;

  const playlist = (ref.playlistId ? game.playlists.get(ref.playlistId) : null)
    ?? (ref.playlistName ? game.playlists.getName(ref.playlistName) : null);

  if (!playlist) {
    warnings.push(`${context}: playlist "${ref.playlistName ?? ref.playlistId}" not found — reference cleared.`);
    return null;
  }

  if (!ref.soundId && !ref.soundName) return { playlistId: playlist.id, soundId: null };

  const sound = (ref.soundId ? playlist.sounds.get(ref.soundId) : null)
    ?? (ref.soundName ? playlist.sounds.find(s => s.name === ref.soundName) : null);

  if (!sound) {
    warnings.push(
      `${context}: track "${ref.soundName ?? ref.soundId}" not found in playlist "${playlist.name}" — the whole playlist will be used instead.`
    );
    return { playlistId: playlist.id, soundId: null };
  }

  return { playlistId: playlist.id, soundId: sound.id };
}

/**
 * Resolves a macro reference to a usable macroId in the current world.
 *
 * Resolution order:
 *   1. `fromUuid(macroId)` — works for compendium UUIDs (Compendium.module.macros.id)
 *   2. `game.macros.get(macroId)` — works when source and destination are the same world
 *   3. `game.macros.find(m => m.name === macroName)` — name-based fallback
 *
 * @param {string|null} macroId   - stored macro ID or UUID
 * @param {string|null} macroName - name of the macro, for fallback resolution
 * @param {string[]}    warnings  - mutable warnings array
 * @param {string}      context   - human-readable location for the warning message
 * @returns {Promise<string|null>} resolved macroId, or null if not found
 */
export async function resolveMacroId(macroId, macroName, warnings, context) {
  if (macroId) {
    // UUID path — covers compendium macros
    try {
      const doc = await fromUuid(macroId);
      if (doc) return macroId;
    } catch { /* not a valid UUID */ }

    // Same-world path — macroId matches directly
    if (game.macros.get(macroId)) return macroId;
  }

  // Name-based fallback
  if (macroName) {
    const macro = game.macros.find(m => m.name === macroName);
    if (macro) return macro.id;
  }

  if (macroId || macroName) {
    warnings.push(`${context}: macro "${macroName ?? macroId}" not found — reference cleared.`);
  }
  return null;
}
