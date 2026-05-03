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
        case "TELEPORT_USER":
          this._handleTeleportUser(payload);
          break;
        case "HUD_REFRESH":
          this._handleHudRefresh(payload);
          break;
        case "NAV_REQUEST":
          this._handleNavRequest(payload);
          break;
        case "NAV_APPROVED":
          this._handleNavApproved(payload);
          break;
        case "NAV_REJECTED":
          this._handleNavRejected(payload);
          break;
        case "MOVE_TOKEN":
          this._handleMoveToken(payload);
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

  /**
   * Received by all clients. Only the target user views the scene and refreshes their HUD.
   * Triggered by GM-initiated teleport from the manager right-click menu.
   * @param {{ sceneId: string, userId: string }} payload
   */
  async _handleTeleportUser({ sceneId, userId } = {}) {
    if (game.userId !== userId) return;
    const scene = game.scenes.get(sceneId);
    if (scene) await scene.view();
    const hud = globalThis.ClickAdventure._hud;
    if (hud?.rendered) hud.render({ force: true });
  }

  /**
   * Received by all clients. Only the target user refreshes their HUD (no scene change).
   * @param {{ userId: string }} payload
   */
  _handleHudRefresh({ userId } = {}) {
    if (game.userId !== userId) return;
    const hud = globalThis.ClickAdventure._hud;
    if (hud?.rendered) hud.render({ force: true });
  }

  /**
   * Tells a specific user's client to view a scene (GM-initiated teleport).
   * @param {string} sceneId
   * @param {string} userId
   */
  teleportUser(sceneId, userId) {
    this._emit("TELEPORT_USER", { sceneId, userId });
  }

  /**
   * Tells a specific user's client to re-render their HUD without changing scene.
   * @param {string} userId
   */
  notifyHudRefresh(userId) {
    this._emit("HUD_REFRESH", { userId });
  }

  /**
   * Asks the GM client to move a player's linked actor token from one scene to another.
   * Only the GM client executes the actual token operations.
   * @param {{ userId: string, fromSceneId: string|null, toSceneId: string }} param0
   */
  emitMoveToken({ userId, fromSceneId, toSceneId }) {
    this._emit("MOVE_TOKEN", { userId, fromSceneId, toSceneId });
  }

  /**
   * Received by all clients. Only the GM executes token operations.
   *
   * Logic:
   *  1. Resolve the user's linked actor — bail if none.
   *  2. In toScene: if a token for this actor already exists, do nothing.
   *  3. In fromScene: find the actor's token and delete it.
   *  4. In toScene: create a new token from actor.prototypeToken at center.
   *
   * Triggered by socket message type MOVE_TOKEN.
   * @param {{ userId: string, fromSceneId: string|null, toSceneId: string }} payload
   */
  async _handleMoveToken({ userId, fromSceneId, toSceneId } = {}) {
    if (!game.user.isGM) return;
    if (!toSceneId) return;

    const user = game.users.get(userId);
    if (!user) return;

    const actor = user.character;
    if (!actor) return;

    const toScene = game.scenes.get(toSceneId);
    if (!toScene) return;

    // Token already exists in destination — do nothing.
    const alreadyThere = toScene.tokens.find(t => t.actorId === actor.id);
    if (alreadyThere) return;

    // Delete token from origin scene (if provided and token exists there).
    if (fromSceneId && fromSceneId !== toSceneId) {
      const fromScene = game.scenes.get(fromSceneId);
      if (fromScene) {
        const originToken = fromScene.tokens.find(t => t.actorId === actor.id);
        if (originToken) await originToken.delete();
      }
    }

    // Create a new token in the destination scene at the scene center.
    const proto = actor.prototypeToken.toObject();
    const tokenData = foundry.utils.mergeObject(proto, {
      x: Math.round((toScene.width  / 2) - ((proto.width  ?? 1) * (toScene.grid?.size ?? 100) / 2)),
      y: Math.round((toScene.height / 2) - ((proto.height ?? 1) * (toScene.grid?.size ?? 100) / 2)),
      actorId: actor.id,
      actorLink: true
    });

    await TokenDocument.create(tokenData, { parent: toScene });
  }

  /**
   * Emits a navigation request from a player to the GM.
   * @param {{ fromNodeId: string|null, toNodeId: string }} param0
   */
  requestNavigation({ fromNodeId, toNodeId }) {
    this._emit("NAV_REQUEST", { userId: game.userId, fromNodeId, toNodeId });
  }

  /**
   * Emits GM approval of a navigation request to the target player.
   * @param {string} userId
   * @param {string} toNodeId
   * @param {string|null} sceneId
   */
  approveNavRequest(userId, toNodeId, sceneId) {
    this._emit("NAV_APPROVED", { userId, toNodeId, sceneId });
  }

  /**
   * Emits GM rejection of a navigation request to the target player.
   * @param {string} userId
   */
  rejectNavRequest(userId) {
    this._emit("NAV_REJECTED", { userId });
  }

  /**
   * Received by all clients. Only the GM processes it — adds to the manager's request queue.
   * Opens the manager if it is not already rendered.
   * @param {{ userId: string, fromNodeId: string|null, toNodeId: string }} payload
   */
  _handleNavRequest({ userId, fromNodeId, toNodeId } = {}) {
    if (!game.user.isGM) return;

    const user = game.users.get(userId);
    if (!user) return;

    let manager = foundry.applications.instances.get("manager-app");
    if (!manager?.rendered) {
      manager = new globalThis.ClickAdventure.ManagerApp();
      globalThis.ClickAdventure._manager = manager;
      manager.render({ force: true });
    }

    manager._navRequests.set(userId, {
      userId,
      userName:  user.character?.name ?? user.name,
      userColor: user.color?.css ?? user.color ?? "#ffffff",
      fromNodeId,
      toNodeId,
      timestamp: Date.now()
    });

    manager._patchRequestsDrawer();
  }

  /**
   * Received by all clients. Only the target player navigates.
   * @param {{ userId: string, toNodeId: string, sceneId: string|null }} payload
   * @returns {Promise<void>}
   */
  async _handleNavApproved({ userId, toNodeId, sceneId } = {}) {
    if (game.userId !== userId) return;

    if (sceneId) {
      const scene = game.scenes.get(sceneId);
      if (scene) await scene.view();
    }

    await game.user.setFlag("click-adventure", "currentNodeId", toNodeId);
    this.emitPlayerMoved(toNodeId);

    const hud = globalThis.ClickAdventure._hud;
    if (hud?.rendered) hud.render({ force: true });

    ui.notifications.info("Navigation approved!");
  }

  /**
   * Received by all clients. Only the target player sees the rejection notice.
   * @param {{ userId: string }} payload
   */
  _handleNavRejected({ userId } = {}) {
    if (game.userId !== userId) return;
    ui.notifications.warn("Navigation request denied by the GM.");
  }
}
