/**
 * Shared utility for resolving a node's active image source.
 * Kept in a separate module to avoid circular imports between manager-app,
 * nav-hud-app, and the module entry point.
 */

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
