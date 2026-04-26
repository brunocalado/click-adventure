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
