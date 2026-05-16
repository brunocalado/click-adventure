/**
 * Utility helpers for the Auto-Lock feature.
 * Centralises all lock read/write logic so NavHudApp, ManagerApp, and
 * AdventureSocketManager can share it without circular imports.
 */

/**
 * Returns true if the given node should lock a player upon arrival,
 * given the current autolockDefault world setting.
 * GMs are never locked.
 *
 * Called during the ApplicationV2 _prepareContext and _navigateTo stages.
 *
 * @param {object} node - graph node with optional autolockMode field
 * @returns {boolean}
 */
export function shouldLockOnArrival(node) {
  if (game.user.isGM) return false;
  const mode = node?.autolockMode ?? "inherit";
  if (mode === "open")   return false;
  if (mode === "locked") return true;
  // "inherit" — follows the global GM toggle
  return game.settings.get("click-adventure", "autolockDefault") === true;
}

/**
 * Returns true if the given userId is currently locked in any node.
 *
 * @param {string} userId
 * @returns {boolean}
 */
export function isUserLocked(userId) {
  const locked = game.settings.get("click-adventure", "lockedUsers") ?? [];
  return locked.some(e => e.userId === userId);
}

/**
 * Adds a lock entry for userId at nodeId. No-op if already locked.
 * Only the GM client should call this — lockedUsers is a world-scope setting.
 *
 * @param {string} userId
 * @param {string} nodeId
 * @returns {Promise<void>}
 */
export async function lockUser(userId, nodeId) {
  const locked = [...(game.settings.get("click-adventure", "lockedUsers") ?? [])];
  if (locked.some(e => e.userId === userId)) return;
  locked.push({ userId, nodeId });
  await game.settings.set("click-adventure", "lockedUsers", locked);
}

/**
 * Removes the lock entry for userId. No-op if not locked.
 * Only the GM client should call this — lockedUsers is a world-scope setting.
 *
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function unlockUser(userId) {
  const locked = (game.settings.get("click-adventure", "lockedUsers") ?? [])
    .filter(e => e.userId !== userId);
  await game.settings.set("click-adventure", "lockedUsers", locked);
}

/**
 * Locks ALL non-GM users (online and offline).
 * Pure utility — no dependency on ManagerApp instance.
 * Only the GM client should call this.
 *
 * Called from the pauseGame hook so navigation is blocked while the world is paused.
 *
 * @returns {Promise<void>}
 */
export async function lockAllUsers() {
  const players = game.users.filter(u => !u.isGM);
  for (const user of players) {
    const nodeId = user.getFlag("click-adventure", "currentNodeId") ?? "";
    await lockUser(user.id, nodeId);
    globalThis.ClickAdventure._socket.notifyLockChanged(user.id);
  }
}

/**
 * Replaces the entire lockedUsers setting with the provided snapshot array,
 * then notifies every non-GM user of their new lock state.
 * Used to restore the pre-pause lock state on unpause.
 * Only the GM client should call this.
 *
 * @param {Array<{userId: string, nodeId: string}>} snapshot
 * @returns {Promise<void>}
 */
export async function restoreLockedUsers(snapshot) {
  await game.settings.set("click-adventure", "lockedUsers", snapshot);
  const players = game.users.filter(u => !u.isGM);
  for (const user of players) {
    globalThis.ClickAdventure._socket.notifyLockChanged(user.id);
  }
}
