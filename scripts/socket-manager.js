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

import { MODULE_ID } from "./constants.js";
import { getGraphData, getActiveGroup, fireActiveItemMacro } from "./node-utils.js";
import { lockUser, unlockUser } from "./autolock-utils.js";

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
        case "REQUEST_LOCK":
          this._handleRequestLock(payload);
          break;
        case "LOCK_CHANGED":
          this._handleLockChanged(payload);
          break;
        case "ACTIVATE_GRAPH":
          this._handleActivateGraph(payload);
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
   * @param {{ sceneId: string, userId: string, nodeId: string|null }} payload
   */
  async _handleTeleportUser({ sceneId, userId, nodeId } = {}) {
    if (game.userId !== userId) return;

    const scene = game.scenes.get(sceneId);
    if (scene) await scene.view();

    if (nodeId) {
      const { nodes } = getGraphData();
      const node = nodes.find(n => n.id === nodeId);
      if (node) await fireActiveItemMacro(node, "player-view", sceneId);
    }

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
   * @param {string|null} [nodeId=null]
   */
  teleportUser(sceneId, userId, nodeId = null) {
    this._emit("TELEPORT_USER", { sceneId, userId, nodeId });
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

    // Per-group toggle: skip auto token loading when disabled for the active group.
    if (getActiveGroup()?.loadPlayerTokens === false) return;

    const user = game.users.get(userId);
    if (!user) return;

    const actor = user.character;
    if (!actor) return;

    const toScene = game.scenes.get(toSceneId);
    if (!toScene) return;

    // Token already exists in destination — do nothing.
    const alreadyThere = toScene.tokens.find(t => t.actorId === actor.id);
    if (alreadyThere) return;

    // Resolve spawn position BEFORE deleting the origin token (order is critical).
    const proto = actor.prototypeToken.toObject();
    const useDefaultPos = game.settings.get(MODULE_ID,"useDefaultTokenPositions");

    // Saved position (only when toggle is on).
    const savedPos = useDefaultPos
      ? (game.settings.get(MODULE_ID,"defaultTokenPositions") ?? {})[user.id] ?? null
      : null;

    // Origin position: where the token was in the previous scene (only when toggle is off).
    let originPos = null;
    if (!savedPos && fromSceneId && fromSceneId !== toSceneId) {
      const fromScene = game.scenes.get(fromSceneId);
      if (fromScene) {
        const originToken = fromScene.tokens.find(t => t.actorId === actor.id);
        if (originToken) originPos = { x: originToken.x, y: originToken.y };
      }
    }

    // Priority: savedPos → originPos → scene center.
    const centerX = Math.round((toScene.width  / 2) - ((proto.width  ?? 1) * (toScene.grid?.size ?? 100) / 2));
    const centerY = Math.round((toScene.height / 2) - ((proto.height ?? 1) * (toScene.grid?.size ?? 100) / 2));

    const spawnX = (savedPos ?? originPos)?.x ?? centerX;
    const spawnY = (savedPos ?? originPos)?.y ?? centerY;

    // Delete token from origin scene (if provided and token exists there).
    // Must happen AFTER reading originPos above.
    if (fromSceneId && fromSceneId !== toSceneId) {
      const fromScene = game.scenes.get(fromSceneId);
      if (fromScene) {
        const originToken = fromScene.tokens.find(t => t.actorId === actor.id);
        if (originToken) await originToken.delete();
      }
    }

    const tokenData = foundry.utils.mergeObject(proto, {
      x: spawnX,
      y: spawnY,
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

    await game.user.setFlag(MODULE_ID,"currentNodeId", toNodeId);

    if (toNodeId) {
      const { nodes } = getGraphData();
      const node = nodes.find(n => n.id === toNodeId);
      if (node) await fireActiveItemMacro(node, "player-view", sceneId ?? null);
    }

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

  /**
   * Emits a lock request from a player to the GM.
   * Called from NavHudApp._navigateTo() when the destination node requires a lock.
   * @param {{ userId: string, nodeId: string }} param0
   */
  emitRequestLock({ userId, nodeId }) {
    this._emit("REQUEST_LOCK", { userId, nodeId });
  }

  /**
   * Broadcasts to all clients that a specific player's lock state has changed.
   * Called by the GM after writing to the lockedUsers setting.
   * @param {string} userId
   */
  notifyLockChanged(userId) {
    this._emit("LOCK_CHANGED", { userId });
  }

  /**
   * Broadcasts to all clients that the active graph has changed.
   * Called by GroupManagerApp after persisting the new activeGraphId.
   * @param {string} graphId
   */
  activateGraph(graphId) {
    this._emit("ACTIVATE_GRAPH", { graphId });
  }

  /**
   * Received by all clients when the active graph changes.
   * Re-renders the HUD and Manager so they reflect the new active graph.
   * Triggered by socket message type ACTIVATE_GRAPH.
   * @param {{ graphId: string }} _payload
   */
  _handleActivateGraph(_payload = {}) {
    const hud = globalThis.ClickAdventure._hud;
    if (hud?.rendered) hud.render({ force: true });

    const manager = foundry.applications.instances.get("manager-app");
    if (manager?.rendered) manager.render({ force: true });
  }

  /**
   * Received by all clients. Only the GM client registers the lock.
   * After writing, notifies the player so their HUD re-renders.
   * Triggered by socket message type REQUEST_LOCK.
   * @param {{ userId: string, nodeId: string }} payload
   */
  async _handleRequestLock({ userId, nodeId } = {}) {
    if (!game.user.isGM) return;
    if (!userId) return;
    await lockUser(userId, nodeId);
    this.notifyLockChanged(userId);
    // Patch the manager sidebar immediately so the GM sees the new lock icon.
    const manager = foundry.applications.instances.get("manager-app");
    if (manager?.rendered) manager._patchOccupantAvatars();
  }

  /**
   * Received by all clients. Only the targeted player re-renders their HUD.
   * Triggered by socket message type LOCK_CHANGED.
   * @param {{ userId: string }} payload
   */
  _handleLockChanged({ userId } = {}) {
    if (game.userId !== userId) return;
    const hud = globalThis.ClickAdventure._hud;
    if (hud?.rendered) hud.render({ force: true });
  }
}
