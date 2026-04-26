/**
 * Shared utility for resolving a node's active image source and reading link passage data.
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
