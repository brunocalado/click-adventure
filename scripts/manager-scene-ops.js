/**
 * Scene creation, import, sync, and reset operations for the Manager workspace.
 * Extracted from ManagerApp to keep the main shell small.
 *
 * Every function receives the ManagerApp instance as `app` so it can
 * access `app.element`, `app._pan`, and trigger renders.
 */

import { MODULE_ID } from "./constants.js";
import { getNodeActiveImage, getGraphData, getActiveGroup, saveGraphData, fireActiveItemMacro, fireNodeMacros } from "./node-utils.js";
import { onSetActiveNode } from "./manager-players.js";
import { buildSceneData } from "./scene-template.js";
import { NODE_W, NODE_H } from "./manager-graph.js";
import { onZoomAll } from "./manager-interaction.js";

// ---------------------------------------------------------------------------
// Node creation
// ---------------------------------------------------------------------------

/**
 * Creates a new node at the workspace center and saves it.
 * @param {ManagerApp} app
 * @returns {Promise<void>}
 */
export async function onAddNode(app) {
  const { sceneId, startNodeId, nodes, links } = getGraphData();
  const workspace = app.element?.querySelector(".ca-workspace");
  const w = workspace?.clientWidth  ?? 600;
  const h = workspace?.clientHeight ?? 400;
  const zoom = app._zoom ?? 1;

  // Place the node at the center of the visible viewport, in canvas space.
  // Mirrors the screen->canvas conversion used elsewhere — (screen - pan) / zoom —
  // so creation stays accurate at any zoom level (not just 100%).
  const newNode = {
    id: foundry.utils.randomID(),
    label: "Scene",
    images: [],
    activeImageIndex: 0,
    sceneId: null,
    x: Math.round((w / 2 - app._pan.x) / zoom - NODE_W / 2),
    y: Math.round((h / 2 - app._pan.y) / zoom - NODE_H / 2)
  };

  // First node added automatically becomes the start node
  const newStartNodeId = nodes.length === 0 ? newNode.id : startNodeId;
  await saveGraphData({ sceneId, startNodeId: newStartNodeId, nodes: [...nodes, newNode], links });
  app.render({ force: true });
}

// ---------------------------------------------------------------------------
// Folder import
// ---------------------------------------------------------------------------

/**
 * Opens a FilePicker in folder-selection mode.
 * When the user confirms a folder, reads all image files in it and creates one
 * new node per image not already present in the graph (duplicate detection via images[0].src).
 *
 * @param {ManagerApp} app
 * @returns {void}
 */
export function onImportFolder(app) {
  const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "webm", "mp4"]);

  // Resolve the active FilePicker implementation (handles The Forge and other hosts)
  const FilePickerClass = foundry.applications.apps.FilePicker.implementation
    ?? foundry.applications.apps.FilePicker;

  const picker = new FilePickerClass({
    type: "folder",
    current: "",
    callback: async (folderPath) => {
      let browseResult;
      try {
        browseResult = await foundry.applications.apps.FilePicker.browse("data", folderPath);
      } catch (err) {
        ui.notifications.error(`Click Adventure: Could not read folder "${folderPath}". ${err.message}`);
        return;
      }

      const imageFiles = (browseResult.files ?? []).filter(filePath => {
        const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
        return IMAGE_EXTENSIONS.has(ext);
      });

      if (imageFiles.length === 0) {
        ui.notifications.warn("Click Adventure: No image files found in the selected folder.");
        return;
      }

      const { sceneId, startNodeId, nodes, links } = getGraphData();
      const existingPaths = new Set(nodes.map(n => n.images?.[0]?.src).filter(Boolean));

      const workspace = app.element?.querySelector(".ca-workspace");
      const wsWidth  = workspace?.clientWidth  ?? 800;
      const COLS     = Math.max(1, Math.floor((wsWidth - 40) / (NODE_W + 20)));
      const offsetX  = nodes.length;

      const newNodes = [];
      for (let i = 0; i < imageFiles.length; i++) {
        const filePath = imageFiles[i];
        if (existingPaths.has(filePath)) continue;

        const bare  = filePath.split("/").pop().replace(/\.[^.]+$/, "");
        const label = filenameToLabel(bare);

        const totalIndex = offsetX + newNodes.length;
        const col = totalIndex % COLS;
        const row = Math.floor(totalIndex / COLS);
        const x   = 20 + col * (NODE_W + 20);
        const y   = 20 + row * (NODE_H + 40);

        newNodes.push({
          id: foundry.utils.randomID(),
          label,
          images: [{ src: filePath }],
          activeImageIndex: 0,
          sceneId: null,
          x,
          y
        });
      }

      if (newNodes.length === 0) {
        ui.notifications.info("Click Adventure: All images in this folder are already imported.");
        return;
      }

      const newStartNodeId = nodes.length === 0 ? newNodes[0].id : startNodeId;
      await saveGraphData({ sceneId, startNodeId: newStartNodeId, nodes: [...nodes, ...newNodes], links });

      await app.render({ force: true });
      onZoomAll(app);
      ui.notifications.info(`Click Adventure: Imported ${newNodes.length} node(s).`);
    }
  });

  picker.render(true);
}

/**
 * Converts a raw filename (without extension) to a human-readable label.
 * Hyphens and underscores become spaces; each word is title-cased except
 * pure-numeric tokens (e.g. "01") which are left as-is.
 *
 * @param {string} filename — bare filename without path or extension
 * @returns {string}
 */
export function filenameToLabel(filename) {
  return filename
    .replace(/[-_]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .split(" ")
    .map(word => {
      if (/^\d+$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// Scene sync
// ---------------------------------------------------------------------------

/**
 * Resolves the Scene folder owned by a group.
 *
 * Association is by the `graphId` flag on the Folder — never by name — so the
 * lookup is immune to renames and to name collisions with the legacy shared
 * "Click Adventure" folder. Returns undefined when the group has no folder yet
 * (or the GM deleted it manually, leaving the flag dangling on nothing).
 *
 * @param {{ id: string }} group
 * @returns {Folder|undefined}
 */
export function getGroupFolder(group) {
  if (!group?.id) return undefined;
  return game.folders.find(
    f => f.type === "Scene" && f.getFlag(MODULE_ID, "graphId") === group.id
  );
}

/**
 * Finds or creates the Scene folder owned by a group. If the GM deleted the
 * folder, {@link getGroupFolder} returns nothing and a fresh one is created,
 * so the next "Create Scenes" press always works.
 *
 * @param {{ id: string, name?: string }} group
 * @returns {Promise<Folder>}
 */
export async function getOrCreateGroupFolder(group) {
  const existing = getGroupFolder(group);
  if (existing) return existing;
  return Folder.create({
    name: `Click Adventure — ${group.name ?? "Adventure"}`,
    type: "Scene",
    sorting: "a",
    flags: { [MODULE_ID]: { graphId: group.id } }
  });
}

/**
 * Deletes a group's Scene folder along with every scene inside it.
 * No-op when the group has no folder. Scenes are removed in a single batch.
 *
 * @param {{ id: string }} group
 * @returns {Promise<void>}
 */
export async function deleteGroupSceneFolder(group) {
  const folder = getGroupFolder(group);
  if (!folder) return;
  const sceneIds = game.scenes.filter(s => s.folder?.id === folder.id).map(s => s.id);
  if (sceneIds.length) await Scene.deleteDocuments(sceneIds);
  await folder.delete();
}

/**
 * Creates a Foundry Scene for a single node and returns the new scene's id.
 * The scene gets a 1920×1080 canvas; if the node has an active image, a managed
 * background tile is created immediately.
 *
 * @param {object} node
 * @param {string} folderId
 * @returns {Promise<string>} the new scene id
 */
export async function createSceneForNode(node, folderId) {
  const rawImage = getNodeActiveImage(node);
  const activeImage = rawImage || null;

  const sceneData = buildSceneData(node.label || "Scene");
  sceneData.folder = folderId;
  sceneData.navigation = false;
  const activeImgForNav = node.images?.[node.activeImageIndex ?? 0] ?? node.images?.[0] ?? null;
  sceneData.navName = activeImgForNav?.label?.trim() || "";

  const rawTransition = game.settings.get(MODULE_ID,"transitionType");
  sceneData.transition.type = rawTransition === "null" ? null : rawTransition;

  // Rebuild tiles[0] as a new object to avoid mutating the shared template reference
  const baseTile = sceneData.tiles[0];
  sceneData.tiles = [
    {
      ...baseTile,
      texture: {
        ...baseTile.texture,
        src: activeImage ?? baseTile.texture.src
      },
      locked: true,
      flags: { [MODULE_ID]: { managed: true } }
    }
  ];

  const scene = await Scene.create(sceneData);
  return scene.id;
}

/**
 * Syncs all node scenes: deletes orphaned scenes, creates missing scenes, and
 * updates scene names and background tiles to match current node data.
 *
 * Triggered by the "Sync Scenes" toolbar button.
 * @param {ManagerApp} app
 * @returns {Promise<void>}
 */
export async function onSyncScenes(app) {
  const group = getActiveGroup();
  if (!group) {
    ui.notifications.warn("Click Adventure: No active group to sync.");
    return;
  }
  const { startNodeId = "", nodes = [], links = [] } = group;
  const folder = await getOrCreateGroupFolder(group);
  let updated = 0;

  // Remove scenes in THIS group's folder that no longer correspond to any node.
  // Scoping the scan to the group's own folder is what prevents another group's
  // scenes (and their GM customizations) from ever being deleted here.
  const validSceneIds = new Set(nodes.map(n => n.sceneId).filter(Boolean));
  const orphanIds = game.scenes
    .filter(s => s.folder?.id === folder.id && !validSceneIds.has(s.id))
    .map(s => s.id);
  if (orphanIds.length) await Scene.deleteDocuments(orphanIds);

  const updatedNodes = [...nodes];
  for (let i = 0; i < updatedNodes.length; i++) {
    const node = updatedNodes[i];

    // Create scene if missing or stale
    if (!node.sceneId || !game.scenes.get(node.sceneId)) {
      const newSceneId = await createSceneForNode(node, folder.id);
      updatedNodes[i] = { ...updatedNodes[i], sceneId: newSceneId };
      updated++;
      continue;
    }

    const scene = game.scenes.get(node.sceneId);

    const rawTransitionSync = game.settings.get(MODULE_ID,"transitionType");
    const transitionTypeSync = rawTransitionSync === "null" ? null : rawTransitionSync;
    const activeImgForNav = node.images?.[node.activeImageIndex ?? 0] ?? node.images?.[0] ?? null;
    const navNameSync = activeImgForNav?.label?.trim() || "";
    const sceneUpdate = { "transition.type": transitionTypeSync };
    if (scene.name !== node.label) sceneUpdate.name = node.label;
    if (scene.navName !== navNameSync) sceneUpdate.navName = navNameSync;
    await scene.update(sceneUpdate);

    const activeImage = node.images?.[node.activeImageIndex ?? 0]?.src
                     ?? node.images?.[0]?.src
                     ?? null;

    const tile = scene.tiles.find(t => t.getFlag(MODULE_ID, "managed"));

    if (activeImage) {
      if (!tile) {
        const tileTemplate = buildSceneData("").tiles[0];
        await scene.createEmbeddedDocuments("Tile", [{
          ...tileTemplate,
          texture: { ...tileTemplate.texture, src: activeImage },
          locked: true,
          flags: { [MODULE_ID]: { managed: true } }
        }]);
      } else if (tile.texture.src !== activeImage) {
        await tile.update({ texture: { src: activeImage } });
      }
    } else if (tile) {
      await tile.delete();
    }

    updated++;
  }

  await saveGraphData({ startNodeId, nodes: updatedNodes, links });
  app.render({ force: true });
  ui.notifications.info(`Click Adventure: ${updated} scene(s) synced.`);
}

/**
 * Resets the active group — clears its nodes and links and deletes its Scene
 * folder along with every scene inside it. Other groups are untouched.
 * Requires explicit confirmation. Triggered by the "Reset" toolbar button.
 * @param {ManagerApp} app
 * @returns {Promise<void>}
 */
export async function onResetGraph(app) {
  const group = getActiveGroup();
  if (!group) return;

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Reset Group" },
    content: `<p>This will delete <strong>all nodes, links and Foundry Scenes</strong> in the current group "<strong>${foundry.utils.escapeHTML(group.name ?? "")}</strong>". This cannot be undone.</p><p>Are you sure?</p>`,
    rejectClose: false
  });
  if (!confirmed) return;

  await deleteGroupSceneFolder(group);

  // Clear position flags only for users currently inside this group's nodes —
  // players positioned in other groups must not be disturbed. Single batch update.
  const groupNodeIds = new Set((group.nodes ?? []).map(n => n.id));
  const userUpdates = game.users
    .filter(u => groupNodeIds.has(u.getFlag(MODULE_ID, "currentNodeId")))
    .map(u => ({ _id: u.id, flags: { [MODULE_ID]: { currentNodeId: null } } }));
  if (userUpdates.length) await User.updateDocuments(userUpdates);

  await saveGraphData({ startNodeId: "", nodes: [], links: [] });

  // Close HUD if open — the active group no longer has a valid state
  if (globalThis.ClickAdventure._hud?.rendered) {
    globalThis.ClickAdventure._hud.close();
  }

  app.render({ force: true });
  ui.notifications.info("Click Adventure: group reset.");
}

// ---------------------------------------------------------------------------
// Scene view / activate
// ---------------------------------------------------------------------------

/**
 * Switches the GM's canvas view to the scene associated with the clicked node
 * and fires any macros configured with trigger "gm-view" or "gm-any".
 * Uses scene.view() — only the GM's perspective changes, players are unaffected.
 * @param {ManagerApp} app
 * @param {string} sceneId
 * @param {string} nodeId
 * @returns {Promise<void>}
 */
export async function onViewScene(app, sceneId, nodeId) {
  if (!sceneId) return;
  const scene = game.scenes.get(sceneId);
  if (!scene) {
    ui.notifications.warn("Click Adventure: Scene not found. Try running Update Scenes.");
    return;
  }
  await scene.view();
  if (nodeId) {
    await onSetActiveNode(app, nodeId);
    const { nodes } = getGraphData();
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      await fireActiveItemMacro(node, "gm-view", sceneId);
      await fireNodeMacros(node, "gm-view");
    }
  }
}

/**
 * Globally activates the scene associated with the clicked node for all clients,
 * sets the GM's active node, and fires any macros configured with trigger
 * "gm-activate" or "gm-any".
 * Uses scene.activate() — changes the active scene for everyone.
 * @param {ManagerApp} app
 * @param {string} sceneId
 * @param {string} nodeId
 * @returns {Promise<void>}
 */
export async function onActivateScene(app, sceneId, nodeId) {
  if (!sceneId) return;
  const scene = game.scenes.get(sceneId);
  if (!scene) {
    ui.notifications.warn("Click Adventure: Scene not found. Try running Update Scenes.");
    return;
  }
  await scene.activate();
  if (nodeId) {
    await onSetActiveNode(app, nodeId);
    const { nodes } = getGraphData();
    const node = nodes.find(n => n.id === nodeId);
    if (node) {
      await fireActiveItemMacro(node, "gm-activate", sceneId);
      await fireNodeMacros(node, "gm-activate");
    }
  }
}

/**
 * Resets the executedOnce flag of all "once" macros across every node in the graph.
 * Shows a confirmation dialog first. The button label includes the count of affected
 * macros so the GM knows what will be reset before confirming.
 *
 * @param {ManagerApp} app
 * @returns {Promise<void>}
 */
export async function onResetMacros(app) {
  const { sceneId, startNodeId, nodes, links } = getGraphData();

  // Count how many once-macros are currently in the executed state
  const count = nodes.reduce((total, node) => {
    if (!Array.isArray(node.nodeMacros)) return total;
    return total + node.nodeMacros.filter(
      m => m.executeMode === "once" && m.executedOnce === true
    ).length;
  }, 0);

  if (count === 0) {
    ui.notifications.info("Click Adventure: No executed macros to reset.");
    return;
  }

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Reset Macros" },
    content: `<p>This will reset <strong>${count} executed macro(s)</strong> across all nodes so they can fire again.</p><p>Are you sure?</p>`,
    rejectClose: false
  });
  if (!confirmed) return;

  const updatedNodes = nodes.map(node => {
    if (!Array.isArray(node.nodeMacros)) return node;
    const updatedMacros = node.nodeMacros.map(m =>
      m.executeMode === "once" && m.executedOnce === true
        ? { ...m, executedOnce: false }
        : m
    );
    return { ...node, nodeMacros: updatedMacros };
  });

  await saveGraphData({ sceneId, startNodeId, nodes: updatedNodes, links });
  app.render({ force: true });
  ui.notifications.info(`Click Adventure: ${count} macro(s) reset.`);
}
