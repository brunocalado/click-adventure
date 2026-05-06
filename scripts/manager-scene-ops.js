/**
 * Scene creation, import, sync, and reset operations for the Manager workspace.
 * Extracted from ManagerApp to keep the main shell small.
 *
 * Every function receives the ManagerApp instance as `app` so it can
 * access `app.element`, `app._pan`, and trigger renders.
 */

import { getNodeActiveImage, getGraphData, saveGraphData } from "./node-utils.js";
import { buildSceneData } from "./scene-template.js";
import { NODE_W, NODE_H } from "./manager-graph.js";

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

  const newNode = {
    id: foundry.utils.randomID(),
    label: "Scene",
    images: [],
    activeImageIndex: 0,
    sceneId: null,
    x: Math.round(-app._pan.x + (w - NODE_W) / 2),
    y: Math.round(-app._pan.y + (h - NODE_H) / 2)
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
  const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "svg"]);

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

      app.render({ force: true });
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
 * Finds or creates the "Click Adventure" Scene folder used to group all node scenes.
 * @returns {Promise<Folder>}
 */
export async function getOrCreateFolder() {
  let folder = game.folders.find(
    f => f.name === "Click Adventure" && f.type === "Scene"
  );
  if (!folder) {
    folder = await Folder.create({ name: "Click Adventure", type: "Scene", sorting: "a" });
  }
  return folder;
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
  sceneData.navName = node.label || "Scene";

  const rawTransition = game.settings.get("click-adventure", "transitionType");
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
      flags: { "click-adventure": { managed: true } }
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
  const { sceneId, startNodeId, nodes, links } = getGraphData();
  const folder = await getOrCreateFolder();
  let updated = 0;

  // Remove scenes in the folder that no longer correspond to any node
  const validSceneIds = new Set(nodes.map(n => n.sceneId).filter(Boolean));
  const folderScenes = game.scenes.filter(s => s.folder?.id === folder.id);
  for (const scene of folderScenes) {
    if (!validSceneIds.has(scene.id)) await scene.delete();
  }

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

    const rawTransitionSync = game.settings.get("click-adventure", "transitionType");
    const transitionTypeSync = rawTransitionSync === "null" ? null : rawTransitionSync;
    const sceneUpdate = { "transition.type": transitionTypeSync };
    if (scene.name !== node.label) sceneUpdate.name = node.label;
    if (scene.navName !== node.label) sceneUpdate.navName = node.label;
    await scene.update(sceneUpdate);

    const activeImage = node.images?.[node.activeImageIndex ?? 0]?.src
                     ?? node.images?.[0]?.src
                     ?? null;

    const tile = scene.tiles.find(t => t.getFlag("click-adventure", "managed"));

    if (activeImage) {
      if (!tile) {
        const tileTemplate = buildSceneData("").tiles[0];
        await scene.createEmbeddedDocuments("Tile", [{
          ...tileTemplate,
          texture: { ...tileTemplate.texture, src: activeImage },
          locked: true,
          flags: { "click-adventure": { managed: true } }
        }]);
      } else if (tile.texture.src !== activeImage) {
        await tile.update({ texture: { src: activeImage } });
      }
    } else if (tile) {
      await tile.delete();
    }

    updated++;
  }

  await saveGraphData({ sceneId, startNodeId, nodes: updatedNodes, links });
  app.render({ force: true });
  ui.notifications.info(`Click Adventure: ${updated} scene(s) synced.`);
}

/**
 * Resets the entire graph — clears all nodes, links, and deletes all scenes
 * in the "Click Adventure" folder. Requires explicit confirmation.
 * Triggered by the "Reset" toolbar button.
 * @param {ManagerApp} app
 * @returns {Promise<void>}
 */
export async function onResetGraph(app) {
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Reset Graph" },
    content: "<p>This will delete <strong>all nodes, links and their Foundry Scenes</strong>. This cannot be undone.</p><p>Are you sure?</p>",
    rejectClose: false
  });
  if (!confirmed) return;

  // Delete all scenes in the "Click Adventure" folder
  const folder = game.folders.find(
    f => f.name === "Click Adventure" && f.type === "Scene"
  );
  if (folder) {
    const folderScenes = game.scenes.filter(s => s.folder?.id === folder.id);
    for (const scene of folderScenes) await scene.delete();
    await folder.delete();
  }

  // Clear all users' position flags in a single batch — sequential await loops are prohibited
  const userUpdates = game.users.map(u => ({
    _id: u.id,
    flags: { "click-adventure": { "currentNodeId": null } }
  }));
  await User.updateDocuments(userUpdates);

  await saveGraphData({ sceneId: "", startNodeId: "", nodes: [], links: [] });

  // Close HUD if open — it no longer has a valid state
  if (globalThis.ClickAdventure._hud?.rendered) {
    globalThis.ClickAdventure._hud.close();
  }

  app.render({ force: true });
  ui.notifications.info("Click Adventure: graph reset.");
}
