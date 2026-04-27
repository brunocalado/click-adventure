/**
 * AdventureSocketManager
 *
 * Handles all real-time socket communication for Click Adventure.
 * Uses Foundry's native game.socket (socket.io v4) with a { type, payload }
 * dispatch pattern. No socketlib dependency required.
 *
 * Socket namespace: "module.click-adventure"
 * Requires "socket": true in module.json.
 *
 * Supported message types:
 *   VIEW_SCENE_FOR_USER — target client calls scene.view() locally.
 *   PLAYER_MOVED — notifies the GM's manager to patch occupant avatars without re-render.
 *
 * Per-client scene viewing:
 *   Players cannot call scene.activate() (GM-only). Instead, a player emits
 *   VIEW_SCENE_FOR_USER with { sceneId, userId }. All clients receive the broadcast;
 *   the target client checks game.userId and calls scene.view() locally.
 *
 *   The emitting client does NOT receive its own broadcast (socket.io rule),
 *   so the emitter calls scene.view() directly before emitting.
 */

const SOCKET_ID = "module.click-adventure";

export class AdventureSocketManager {
  constructor() {
    this._registerListeners();
  }

  /**
   * Registers the socket listener once during init.
   * All incoming messages are dispatched by type.
   */
  _registerListeners() {
    game.socket.on(SOCKET_ID, (message) => {
      const { type, payload } = message ?? {};
      switch (type) {
        case "VIEW_SCENE_FOR_USER":
          this._handleViewSceneForUser(payload);
          break;
        case "PLAYER_MOVED":
          this._handlePlayerMoved(payload);
          break;
        default:
          console.warn(`AdventureSocketManager | Unknown message type: ${type}`);
      }
    });
  }

  /**
   * Emits a socket message to all other clients.
   * @param {string} type
   * @param {object} payload
   */
  _emit(type, payload) {
    game.socket.emit(SOCKET_ID, { type, payload });
  }

  /**
   * Requests that a specific user's client view a scene locally (not globally activate it).
   * The emitting client views the scene immediately (it does not receive its own broadcast).
   * All other clients receive the broadcast and check if they are the target user.
   *
   * @param {string} sceneId - Foundry Scene document id
   * @param {string} userId - target user's game.userId
   * @returns {Promise<void>}
   */
  async viewSceneForUser(sceneId, userId) {
    const scene = game.scenes.get(sceneId);
    if (!scene) {
      console.warn(`AdventureSocketManager | Scene not found: ${sceneId}`);
      return;
    }

    // Execute locally for the emitting client (socket.io does not echo to emitter)
    if (game.userId === userId) {
      await scene.view();
    }

    // Broadcast to all other clients; they check userId in the handler
    this._emit("VIEW_SCENE_FOR_USER", { sceneId, userId });
  }

  /**
   * Broadcasts that a player has moved to a new node.
   * Called from NavHudApp._navigateTo() after setFlag.
   * @param {string} nodeId — the node the player just arrived at
   */
  emitPlayerMoved(nodeId) {
    this._emit("PLAYER_MOVED", { userId: game.userId, nodeId });
  }

  /**
   * Received by all clients when any player changes node.
   * On the GM client, triggers a lightweight DOM patch of the manager (no full re-render).
   * Triggered by socket message type PLAYER_MOVED.
   * @param {{ userId: string, nodeId: string }} payload
   */
  _handlePlayerMoved({ userId, nodeId } = {}) {
    if (!game.user.isGM) return;
    const manager = foundry.applications.instances.get("manager-app");
    if (!manager?.rendered) return;
    manager._patchOccupantAvatars();
  }

  /**
   * Handler executed on every non-emitting client.
   * Only the target user actually views the scene.
   *
   * @param {{ sceneId: string, userId: string }} payload
   */
  async _handleViewSceneForUser({ sceneId, userId } = {}) {
    if (!sceneId || !userId) return;
    if (game.userId !== userId) return;

    const scene = game.scenes.get(sceneId);
    if (!scene) {
      console.warn(`AdventureSocketManager | Scene not found on receiver: ${sceneId}`);
      return;
    }

    await scene.view();
  }
}
