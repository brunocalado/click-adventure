/**
 * Shared utility for resolving a node's active image source, reading link passage data,
 * and syncing a node's managed background tile with its current active image.
 * Kept in a separate module to avoid circular imports between manager-app,
 * node-config-app, nav-hud-app, and the module entry point.
 */

import { buildSceneData } from "./scene-template.js";

/**
 * Returns the active image src for a node.
 * Supports both the new multi-image schema (images[]) and the legacy imageSrc field.
 *
 * @param {object} node
 * @returns {string}
 */
export function getNodeActiveImage(node) {
  if (Array.isArray(node.images) && node.images.length > 0) {
    const idx = node.activeImageIndex ?? 0;
    return node.images[idx]?.src ?? "";
  }
  return node.imageSrc ?? "";
}

/**
 * Returns true when a link carries more than one passage.
 * Multi-passage links open the LinkEditorApp instead of cycling direction on click.
 *
 * @param {object} link
 * @returns {boolean}
 */
export function isMultiPassage(link) {
  return (link.passages?.length ?? 0) > 1;
}

/**
 * Returns the effective traversal direction for a single-passage link.
 * Falls back to the legacy flat `direction` field for links not yet migrated.
 *
 * @param {object} link
 * @returns {string} "both" | "forward" | "backward" | "blocked"
 */
export function getEffectiveDirection(link) {
  return link.passages?.[0]?.direction ?? link.direction ?? "both";
}

/**
 * Syncs the managed background tile in a node's Foundry Scene with the node's
 * current active image. Creates the tile if missing, removes it when there is no
 * active image, and updates texture.src when the image changes.
 *
 * The managed tile is identified by the flag "click-adventure.managed" so that
 * GM-placed tiles in the same scene are never touched.
 *
 * Called from NodeConfigApp._saveActiveIndex (immediate image switch) and
 * NodeConfigApp._saveAll (label/image save).
 *
 * @param {object} node - Graph node with optional sceneId and images array.
 * @returns {Promise<void>}
 */
export async function syncNodeTile(node) {
  if (!node.sceneId) return;
  const scene = game.scenes.get(node.sceneId);
  if (!scene) return;

  const rawImage = getNodeActiveImage(node);
  const activeImage = rawImage || null;

  const tile = scene.tiles.find(t => t.getFlag("click-adventure", "managed"));

  if (activeImage) {
    if (!tile) {
      const baseTile = buildSceneData("").tiles[0];
      await scene.createEmbeddedDocuments("Tile", [{
        ...baseTile,
        texture: { ...baseTile.texture, src: activeImage },
        locked: true,
        flags: { "click-adventure": { managed: true } }
      }]);
    } else if (tile.texture.src !== activeImage) {
      await tile.update({ texture: { src: activeImage } });
    }
  } else if (tile) {
    await tile.delete();
  }
}

/**
 * Persists a new activeImageIndex for a node and syncs its managed background tile.
 * Extracted from NodeConfigApp._saveActiveIndex so the HUD can reuse it without
 * instantiating the config panel.
 *
 * @param {string} nodeId - graph node id
 * @param {number} index  - index into the node's images array
 * @returns {Promise<void>}
 */
export async function setNodeActiveImageIndex(nodeId, index) {
  const { sceneId, startNodeId, nodes, links } = getGraphData();
  const updatedNodes = nodes.map(n => {
    if (n.id !== nodeId) return n;
    return { ...n, activeImageIndex: index };
  });
  await saveGraphData({ sceneId, startNodeId, nodes: updatedNodes, links });
  const updatedNode = updatedNodes.find(n => n.id === nodeId);
  if (updatedNode) await syncNodeTile(updatedNode);
}

/**
 * Ordered direction cycle used when the GM clicks a link to change its traversal mode.
 * Each key is the current state; the value is the next state in the cycle.
 * All 5 states are persisted in the graph data — none is display-only.
 *
 * State reference:
 *   "both"     — Bidirectional. Players on either side see the link and can traverse it.
 *   "forward"  — One-way: source → target only. Players on the target side do not see it.
 *   "backward" — One-way: target → source only. Players on the source side do not see it.
 *   "blocked"  — Completely hidden. Does not appear in the HUD for anyone. Useful for
 *                temporarily disabling a connection without deleting it.
 *   "locked"   — Visible in the HUD (shown with a lock icon ⊘) but not navigable.
 *                Players can see the destination but clicking it does nothing.
 *                Useful for hinting at a passage that hasn't been unlocked yet.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const DIRECTION_CYCLE = Object.freeze({
  both:     "forward",   // free → one-way forward
  forward:  "backward",  // one-way forward → one-way backward
  backward: "blocked",   // one-way backward → completely hidden
  blocked:  "locked",    // hidden → visible but not navigable
  locked:   "both",      // locked → free (cycle restarts)
});

/** Cycle used for individual passages inside a multi-passage link. "blocked" is excluded
 *  because the "✕ Remove passage" button already serves that purpose more clearly.
 *  both → forward → backward → locked → both
 */
export const PASSAGE_DIRECTION_CYCLE = Object.freeze({
  both:     "forward",
  forward:  "backward",
  backward: "locked",
  locked:   "both",
});

/**
 * Returns the current adventure graph as a plain object.
 * Converts DataModel instances to POJOs transparently so callers never need
 * to handle the toObject() unwrap pattern themselves.
 *
 * @returns {{ sceneId: string, startNodeId: string, nodes: object[], links: object[] }}
 */
export function getGraphData() {
  const graph = game.settings.get("click-adventure", "graph");
  const raw = typeof graph?.toObject === "function" ? graph.toObject() : (graph ?? {});
  return {
    sceneId:     raw.sceneId     ?? "",
    startNodeId: raw.startNodeId ?? "",
    nodes:       raw.nodes       ?? [],
    links:       raw.links       ?? []
  };
}

/**
 * Merges a partial patch into the stored graph and persists it.
 * Reads the current stored value first so callers only need to supply changed fields.
 *
 * @param {Partial<{ sceneId: string, startNodeId: string, nodes: object[], links: object[] }>} patch
 * @returns {Promise<void>}
 */
export async function saveGraphData(patch) {
  const current = getGraphData();
  await game.settings.set("click-adventure", "graph", { ...current, ...patch });
}

/**
 * Fires the macro attached to either the active image or the active linked scene
 * of a node, when that macro's trigger matches the provided trigger string.
 * Executes locally on the calling client — never via socket.
 *
 * Called after navigation events to implement per-image/per-scene macro triggers.
 *
 * @param {object} node          - graph node object
 * @param {string} trigger       - "gm-activate" | "player-view" | "gm-view" | "gm-any"
 * @param {string|null} sceneId  - the sceneId being viewed/activated (used to match linked scenes)
 * @returns {Promise<void>}
 */
export async function fireActiveItemMacro(node, trigger, sceneId = null) {
  const images = Array.isArray(node?.images) ? node.images : [];
  const activeImg = images[node?.activeImageIndex ?? 0];
  await _tryFireMacro(activeImg?.macro, trigger);

  if (sceneId) {
    const ls = (node?.linkedScenes ?? []).find(s => s.sceneId === sceneId);
    await _tryFireMacro(ls?.macro, trigger);
  }
}

/**
 * @param {{ macroId: string, trigger: string }|null|undefined} macroEntry
 * @param {string} trigger
 * @returns {Promise<void>}
 */
async function _tryFireMacro(macroEntry, trigger) {
  if (!macroEntry) return;
  if (macroEntry.trigger !== trigger && macroEntry.trigger !== "gm-any") return;
  const macro = game.macros.get(macroEntry.macroId);
  if (!macro) {
    console.warn(`Click Adventure | Macro ${macroEntry.macroId} not found — was it deleted?`);
    return;
  }
  try {
    await macro.execute();
  } catch (err) {
    console.error(`Click Adventure | Macro "${macro.name}" failed:`, err);
  }
}

/**
 * Fires all node-level macros whose trigger matches the provided trigger string.
 * Respects executeMode: "once" macros are skipped if already executed.
 * Marks executed "once" macros and persists the updated node state.
 *
 * Called after fireActiveItemMacro in both onViewScene and onActivateScene.
 * Triggered during navigation events (renderManagerApp lifecycle).
 *
 * @param {object} node    - graph node object
 * @param {string} trigger - "gm-activate" | "gm-view" | "gm-any"
 * @returns {Promise<void>}
 */
export async function fireNodeMacros(node, trigger) {
  if (!Array.isArray(node?.nodeMacros) || node.nodeMacros.length === 0) return;

  const { sceneId, startNodeId, nodes, links } = getGraphData();
  let dirty = false;

  for (const entry of node.nodeMacros) {
    const triggerMatches = entry.trigger === trigger || entry.trigger === "gm-any";
    if (!triggerMatches) continue;
    if (entry.executeMode === "once" && entry.executedOnce === true) continue;

    const macro = game.macros.get(entry.macroId);
    if (!macro) {
      console.warn(`Click Adventure | Node macro ${entry.macroId} not found.`);
      continue;
    }
    try {
      await macro.execute();
    } catch (err) {
      console.error(`Click Adventure | Node macro "${macro.name}" failed:`, err);
    }

    if (entry.executeMode === "once") {
      entry.executedOnce = true;
      dirty = true;
    }
  }

  if (dirty) {
    const updatedNodes = nodes.map(n =>
      n.id === node.id ? { ...n, nodeMacros: node.nodeMacros } : n
    );
    await saveGraphData({ sceneId, startNodeId, nodes: updatedNodes, links });
  }
}
