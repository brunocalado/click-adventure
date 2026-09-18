/**
 * Shared utility for resolving a node's active image source, reading link passage data,
 * and syncing a node's managed background tile with its current active image.
 * Kept in a separate module to avoid circular imports between manager-app,
 * node-config-app, nav-hud-app, and the module entry point.
 */

import { MODULE_ID } from "./constants.js";
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
 * Returns true when a link carries more than one passage, or when the link was explicitly
 * promoted to multi-passage mode via the editor (forceMulti flag set on save).
 * Multi-passage links open the LinkEditorApp instead of cycling direction on click.
 *
 * @param {object} link
 * @returns {boolean}
 */
export function isMultiPassage(link) {
  return link.forceMulti === true || (link.passages?.length ?? 0) > 1;
}

/**
 * Returns a link's first passage, synthesising one from the legacy flat `link.direction`
 * field when the link predates the passages array.
 *
 * @param {object} link
 * @returns {object}
 */
export function getFirstPassage(link) {
  return link.passages?.[0] ?? { label: "", direction: link.direction ?? "both" };
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

  const tile = scene.tiles.find(t => t.getFlag(MODULE_ID, "managed"));

  if (activeImage) {
    if (!tile) {
      const baseTile = buildSceneData("").tiles[0];
      await scene.createEmbeddedDocuments("Tile", [{
        ...baseTile,
        texture: { ...baseTile.texture, src: activeImage },
        locked: true,
        flags: { [MODULE_ID]: { managed: true } }
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
 * Returns the Foundry Scene a node is currently showing: the linked scene last picked for
 * it, or its own scene when none is. Picking a linked scene persists on the node the same
 * way picking an image does, so navigating away and back keeps showing the same place.
 *
 * @param {object} node
 * @returns {string|null}
 */
export function getNodeActiveSceneId(node) {
  const activeId = node?.activeLinkedSceneId;
  if (activeId) {
    const linked = (node.linkedScenes ?? []).find(ls => ls.id === activeId);
    // A linked scene removed since it was made active falls back to the node's own scene.
    if (linked?.sceneId) return linked.sceneId;
  }
  return node?.sceneId ?? null;
}

/**
 * Persists which of a node's linked scenes is currently active. Passing null clears the
 * choice, so the node goes back to showing its own scene.
 *
 * @param {string} nodeId
 * @param {string|null} linkedSceneId - the linkedScenes entry id, not the Scene id
 * @returns {Promise<void>}
 */
export async function setNodeActiveLinkedScene(nodeId, linkedSceneId) {
  const { sceneId, startNodeId, nodes, links } = getGraphData();
  const updatedNodes = nodes.map(n =>
    n.id === nodeId ? { ...n, activeLinkedSceneId: linkedSceneId } : n
  );
  await saveGraphData({ sceneId, startNodeId, nodes: updatedNodes, links });
}

/**
 * A passage is described by two independent axes, each stored as its own field:
 *
 *   direction — which side(s) the passage exists on at all.
 *     "both"     — usable from either end.
 *     "forward"  — source → target only. From the target side there is no route at all.
 *     "backward" — target → source only. From the source side there is no route at all.
 *
 *   state — what happens on the side(s) the passage does exist on.
 *     "open"    — normal traversal, no restriction.
 *     "blocked" — visible to everyone (⊘, red) but players cannot cross. The GM still can.
 *     "secret"  — hidden from players entirely; the GM sees it marked (mask, purple) and
 *                 can still cross. Also the way to disable a connection without deleting it.
 *     "custom"  — visible like "blocked", but crossable once the player satisfies the
 *                 passage's `keys` (see evaluatePassageKeys). The GM always bypasses the
 *                 check. `lockedVisibility` ("blocked" | "secret", default "blocked")
 *                 decides whether players see it at all before the keys are satisfied.
 *
 * The two combine freely, so a one-way passage can be Secret on the side it exists on
 * while the other side simply has no route. Expressing two *different* states on the two
 * ends of one connection takes two passages on the same link, not one.
 *
 * Everything below reads or writes those two fields. decomposeDirection is the only
 * exception: it reads the pre-0.3.0 single combined `direction` string.
 */

/**
 * Maps a pre-0.3.0 flat `direction` string onto the two-axis model.
 *
 * The two non-plain legacy values carry names that the current model reuses with the
 * opposite meaning, so they are remapped rather than passed through:
 *
 *   legacy "locked"  — visible but not navigable  → state "blocked"
 *   legacy "blocked" — hidden from players        → state "secret"
 *
 * Reading them literally would silently unlock every locked passage and expose every
 * secret one in worlds created before the rename, so this mapping is what keeps old
 * graph data behaving the way its GM set it up. Nothing writes flat strings any more;
 * this is a read-side fallback only.
 *
 * @param {string} direction
 * @returns {{dirAxis: "both"|"forward"|"backward", stateAxis: "open"|"blocked"|"secret"|"custom"}}
 */
export function decomposeDirection(direction) {
  switch (direction) {
    case "both":
    case "forward":
    case "backward": return { dirAxis: direction, stateAxis: "open" };
    case "locked":   return { dirAxis: "both", stateAxis: "blocked" };
    case "blocked":  return { dirAxis: "both", stateAxis: "secret"  };
    default:         return { dirAxis: "both", stateAxis: "open"    };
  }
}

const DIRECTION_CYCLE = Object.freeze({ both: "forward", forward: "backward", backward: "both" });
const STATE_CYCLE     = Object.freeze({ open: "blocked", blocked: "secret", secret: "custom", custom: "open" });

/**
 * Cycles a passage's direction: both → forward → backward → both.
 * @param {string} current
 * @returns {string}
 */
export function cyclePassageDirection(current) {
  return DIRECTION_CYCLE[current ?? "both"] ?? "both";
}

/**
 * Cycles a passage's state: open → blocked → secret → custom → open.
 * @param {string} current
 * @returns {string}
 */
export function cyclePassageState(current) {
  return STATE_CYCLE[current ?? "open"] ?? "open";
}

/**
 * Resolves a passage's traversal state from one side of its link — the single source of
 * truth for every gameplay decision (HUD listing, the back-route check, the poll options).
 *
 * A passage exists only on the side(s) its direction names; the other side of a one-way
 * passage returns "none" rather than being treated as silently open.
 *
 * @param {object} passage
 * @param {"source"|"target"} side
 * @returns {"open"|"blocked"|"secret"|"custom"|"none"}
 */
export function getPassageStateFromSide(passage, side) {
  const hasAxes = passage?.state !== undefined;
  const direction = passage?.direction ?? "both";
  const { dirAxis, stateAxis } = hasAxes
    ? { dirAxis: direction, stateAxis: passage.state }
    : decomposeDirection(direction);

  if (dirAxis === "both") return stateAxis;
  if (dirAxis === "forward")  return side === "source" ? stateAxis : "none";
  return side === "target" ? stateAxis : "none";
}

/**
 * Walks every passage that touches `nodeId`, yielding the passage together with the node
 * on the far side and its state from this node's point of view. Peek links are skipped —
 * they are not navigation. Shared by the HUD, the back-route check and the poll builder so
 * the three cannot drift apart on what "reachable from here" means.
 *
 * @param {string} nodeId
 * @param {object[]} links
 * @yields {{link: object, passage: object, otherId: string, state: string, multi: boolean}}
 */
export function* iterPassagesFrom(nodeId, links) {
  for (const link of links) {
    if (link.type === "peek") continue;
    const side = link.sourceId === nodeId ? "source"
      : link.targetId === nodeId ? "target"
      : null;
    if (!side) continue;
    const otherId = side === "source" ? link.targetId : link.sourceId;
    if (!otherId) continue;

    const multi = isMultiPassage(link);
    const passages = link.passages?.length ? link.passages : [getFirstPassage(link)];
    for (const passage of passages) {
      const state = getPassageStateFromSide(passage, side);
      if (state === "none") continue;
      yield { link, passage, otherId, state, multi };
    }
  }
}

/**
 * True when no passage leaving this node gives a player a way out. "open" and "custom"
 * count as routes (a key-gated door is still a door); "blocked" and "secret" do not.
 * Drives the Manager's dead-end outline — a GM-only hint that changes no behaviour.
 *
 * @param {string} nodeId
 * @param {object[]} links
 * @returns {boolean}
 */
export function nodeHasNoPlayerExit(nodeId, links) {
  for (const { state } of iterPassagesFrom(nodeId, links)) {
    if (state === "open" || state === "custom") return false;
  }
  return true;
}

/**
 * Records a scene as visited by a user — the data behind the "scene visited" key
 * condition. Idempotent: a no-op when already recorded.
 *
 * @param {User} user
 * @param {string|null} sceneId
 * @returns {Promise<void>}
 */
export async function markSceneVisited(user, sceneId) {
  if (!user || !sceneId) return;
  const visited = user.getFlag(MODULE_ID, "visitedSceneIds") ?? [];
  if (visited.includes(sceneId)) return;
  await user.setFlag(MODULE_ID, "visitedSceneIds", [...visited, sceneId]);
}

/**
 * Clears a user's visited-scene history, re-locking any "scene visited" key condition.
 *
 * @param {User} user
 * @returns {Promise<void>}
 */
export async function clearVisitedScenes(user) {
  await user.unsetFlag(MODULE_ID, "visitedSceneIds");
}

/**
 * Moves a user to a node: sets their position flag and records the node's active scene as
 * visited, in one call. Every path that arrives a user at a node goes through this — HUD
 * navigation, guide mode, gated-mode approval, GM teleport — so a "scene visited" key
 * cannot disagree with where the player has actually been.
 *
 * @param {User} user
 * @param {object} node
 * @returns {Promise<void>}
 */
export async function setUserCurrentNode(user, node) {
  await user.setFlag(MODULE_ID, "currentNodeId", node.id);
  await markSceneVisited(user, getNodeActiveSceneId(node));
}

/**
 * Tests one key condition of a custom-state passage against the current user.
 *
 * The item check deliberately does not compare document ids: an item embedded in an actor
 * is a new document with a new id, so the id of whatever was dragged onto the passage
 * never matches the copy a player actually owns. What survives the copy is
 * `_stats.compendiumSource`, which Foundry stamps with the source uuid when an item is
 * created from a compendium — that is the reliable match. An item dragged from the world
 * Items sidebar has no such stamp on either side, so those fall back to matching by name.
 *
 * @param {object} key
 * @returns {Promise<boolean>}
 */
async function _evaluateKeyCondition(key) {
  switch (key.type) {
    case "item": {
      const actor = game.user.character;
      if (!actor) return false;
      return actor.items.some(it =>
        (key.sourceUuid && it._stats?.compendiumSource === key.sourceUuid) ||
        it.name === key.itemName
      );
    }
    case "actor":
      return game.user.character?.id === key.actorId;
    case "scene": {
      const visited = game.user.getFlag(MODULE_ID, "visitedSceneIds") ?? [];
      return visited.includes(key.sceneId);
    }
    case "macro": {
      const macro = game.macros.get(key.macroId);
      if (!macro) {
        console.warn(`Click Adventure | Key macro ${key.macroId} not found — was it deleted?`);
        return false;
      }
      // A macro the player cannot run makes execute() decline without throwing, which
      // would read as "key not satisfied" and leave the GM with a passage that never
      // opens and no reason why. Say so instead: the macro needs its Ownership raised.
      if (!macro.canExecute) {
        console.warn(`Click Adventure | Key macro "${macro.name}" cannot be run by ${game.user.name} — raise its Ownership to at least Observer, or the passage can never unlock for this player.`);
        return false;
      }
      try {
        // Strictly true, not merely truthy: a chat macro resolves to a ChatMessage, and a
        // script whose last line is `true;` without `return` resolves to undefined. A key
        // macro must end with an explicit `return true;`.
        return (await macro.execute()) === true;
      } catch (err) {
        console.error(`Click Adventure | Key macro "${macro.name}" failed:`, err);
        return false;
      }
    }
    default:
      return false;
  }
}

/**
 * Evaluates a custom-state passage's keys against the current user, combining them with
 * the passage's keyMode ("AND" = all, "OR" = any). An empty key list always passes, so
 * choosing Custom before configuring anything behaves like Open instead of soft-locking
 * the passage. The GM always bypasses the check.
 *
 * `runMacros` is false when the caller is only deciding whether to *show* a passage. A
 * key macro is allowed to have side effects, so it must run when the player actually
 * tries to cross and at no other time — not once per HUD render. Macro keys are simply
 * left out of that evaluation, which at worst reveals a passage the click still refuses.
 *
 * @param {{keys?: object[], keyMode?: "AND"|"OR"}} passage
 * @param {{runMacros?: boolean}} [options]
 * @returns {Promise<boolean>}
 */
export async function evaluatePassageKeys(passage, { runMacros = true } = {}) {
  if (game.user.isGM) return true;
  const keys = (passage?.keys ?? []).filter(k => runMacros || k.type !== "macro");
  if (keys.length === 0) return true;
  const results = await Promise.all(keys.map(_evaluateKeyCondition));
  return (passage?.keyMode ?? "AND") === "OR" ? results.some(Boolean) : results.every(Boolean);
}

/**
 * Returns the active adventure graph as a plain object.
 * Reads from the multi-graph collection (`click-adventure.graphs`) and resolves
 * the active entry by `activeGraphId`. Falls back to the first graph if the id
 * is not found (guards against stale ids after a delete).
 *
 * @returns {{ sceneId: string, startNodeId: string, nodes: object[], links: object[] }}
 */
export function getGraphData() {
  const col = game.settings.get(MODULE_ID, "graphs");
  const raw = typeof col?.toObject === "function" ? col.toObject() : (col ?? {});
  const active = (raw.graphs ?? []).find(g => g.id === raw.activeGraphId)
    ?? raw.graphs?.[0]
    ?? {};
  return {
    sceneId:     "",
    startNodeId: active.startNodeId ?? "",
    nodes:       active.nodes       ?? [],
    links:       active.links       ?? []
  };
}

/**
 * Returns the full active graph entry (including its `id` and `name`), unlike
 * {@link getGraphData} which strips those fields. Needed when an operation must
 * resolve the group's per-group Scene folder (keyed by `id`).
 *
 * @returns {{ id: string, name: string, startNodeId: string, nodes: object[], links: object[] }|null}
 *   The active group, or null when the world has no groups yet.
 */
export function getActiveGroup() {
  const col = game.settings.get(MODULE_ID, "graphs");
  const raw = typeof col?.toObject === "function" ? col.toObject() : (col ?? {});
  return (raw.graphs ?? []).find(g => g.id === raw.activeGraphId)
    ?? raw.graphs?.[0]
    ?? null;
}

/**
 * Merges a partial patch into the active graph and persists the collection.
 * Only the active graph entry is modified; all other groups remain unchanged.
 *
 * If no groups exist yet (fresh world), a "Default" group is created automatically
 * so that the very first save (node add, folder import, sync, etc.) is never lost.
 *
 * @param {Partial<{ startNodeId: string, nodes: object[], links: object[] }>} patch
 * @returns {Promise<void>}
 */
export async function saveGraphData(patch) {
  const col = game.settings.get(MODULE_ID, "graphs");
  const raw = typeof col?.toObject === "function" ? col.toObject() : (col ?? {});

  let graphs        = raw.graphs        ?? [];
  let activeGraphId = raw.activeGraphId ?? "";

  // Auto-provision a Default group on the very first write so data is never silently dropped.
  if (graphs.length === 0) {
    const defaultGroup = {
      id:          foundry.utils.randomID(),
      name:        "Default",
      startNodeId: "",
      nodes:       [],
      links:       []
    };
    graphs        = [defaultGroup];
    activeGraphId = defaultGroup.id;
  }

  const updatedGraphs = graphs.map(g =>
    g.id === activeGraphId ? { ...g, ...patch } : g
  );

  await game.settings.set(MODULE_ID, "graphs", { activeGraphId, graphs: updatedGraphs });
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
 * Decides whether a configured macro trigger fires for the trigger being dispatched.
 * "gm-any" is the GM-side wildcard — it covers "gm-view" and "gm-activate" only.
 * It must never match "player-view", or a macro the GM marked GM-only would run on
 * the player's client.
 *
 * @param {string} entryTrigger - trigger stored on the macro entry
 * @param {string} trigger      - trigger being dispatched
 * @returns {boolean}
 */
function _triggerMatches(entryTrigger, trigger) {
  if (entryTrigger === trigger) return true;
  return entryTrigger === "gm-any" && (trigger === "gm-view" || trigger === "gm-activate");
}

/**
 * @param {{ macroId: string, trigger: string }|null|undefined} macroEntry
 * @param {string} trigger
 * @returns {Promise<void>}
 */
async function _tryFireMacro(macroEntry, trigger) {
  if (!macroEntry) return;
  if (!_triggerMatches(macroEntry.trigger, trigger)) return;
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
 * Called after fireActiveItemMacro on every arrival: onViewScene and onActivateScene
 * in the manager, and NavHudApp._navigateTo plus the socket arrival handlers.
 *
 * @param {object} node    - graph node object
 * @param {string} trigger - "gm-activate" | "player-view" | "gm-view" | "gm-any"
 * @returns {Promise<void>}
 */
export async function fireNodeMacros(node, trigger) {
  if (!Array.isArray(node?.nodeMacros) || node.nodeMacros.length === 0) return;

  const executedOnceIds = [];

  for (const entry of node.nodeMacros) {
    if (!_triggerMatches(entry.trigger, trigger)) continue;
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
      executedOnceIds.push(entry.id);
    }
  }

  if (executedOnceIds.length === 0) return;

  if (game.user.isGM) {
    const { sceneId, startNodeId, nodes, links } = getGraphData();
    const updatedNodes = nodes.map(n =>
      n.id === node.id ? { ...n, nodeMacros: node.nodeMacros } : n
    );
    await saveGraphData({ sceneId, startNodeId, nodes: updatedNodes, links });
  } else {
    // "graphs" is a world-scoped setting — players cannot write it. Ask the GM to
    // persist the executedOnce marks, same proxy pattern as REQUEST_LOCK.
    globalThis.ClickAdventure._socket.emitMacroExecuted({
      nodeId:   node.id,
      entryIds: executedOnceIds
    });
  }
}
