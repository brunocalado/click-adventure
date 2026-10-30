/*!
 * Click Adventure
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Guide-mode travel over a group's overview map: into a room from the map, back out to the map,
 * and room to room without loading the map in between.
 *
 * The GM computes everything and sends it in one FLIGHT message, because by the time a player
 * receives it the GM has already rewritten that player's `currentNodeId` to the destination, so
 * the player could not recover where it came from. Each client then plays its own flight from its
 * own origin, changes scene underneath the overlay with the core transition suppressed for this
 * call only, and runs its arrival macros and journal after the landing, so nothing opens under
 * the flight.
 *
 * Choices made on purpose:
 * - Room to room flies over the overlay's copy of the map instead of panning the real overview
 *   scene, which would mean loading the overview mid-hop: two scene loads and two loading toasts.
 * - The core transition is suppressed per call (view/activate options), never by storing a null
 *   transition on the scenes, so hops that cannot fly (a node without a Region) keep the world's.
 * - Only GM-led Guide moves fly. Players navigating alone, Gated approvals, Manager teleports and
 *   group activation keep their own paths, so the GM conducts and everyone watches the same move.
 * - Rooms are entered by double-clicking their Region rather than from a list in the HUD, which
 *   would grow with every room.
 */

import { MODULE_ID } from "./constants.js";
import {
  getActiveGroup, getGraphData, getNodeActiveSceneId, setUserCurrentNode,
  fireActiveItemMacro, fireNodeMacros
} from "./node-utils.js";
import { openNodeJournal } from "./node-media.js";
import { FlightOverlay, mapScale } from "./flight-overlay.js";
import { getOverviewScene, getOverviewMap, getFlightRooms } from "./flight-data.js";

/** How long a client waits for the destination scene before landing anyway. */
const ARRIVAL_TIMEOUT_MS = 15000;

let busy = false;

/** True when a Guide move by this client should fly: GM, Guide mode, flight on, overview present. */
export function flightAvailable() {
  const group = getActiveGroup();
  return game.user.isGM
    && game.settings.get(MODULE_ID, "gmNavigationMode") === "guide"
    && group?.flight?.enabled === true
    && !!getOverviewScene(group);
}

const isOutline = p => Array.isArray(p) && p.length >= 6 && p.length % 2 === 0 && p.every(Number.isFinite);

/** A FLIGHT payload arrives from the network, so its shape is checked before anything uses it. */
// A slow horror manor and a fast heist want different flights, so the pace belongs to the group.
// Only the group: a world default with a per-group override would need a fourth "use default"
// state and a precedence rule for little gain, and every client flies at the GM's pace, not its own.
const PACE = Object.freeze({ slow: 1.4, normal: 1, fast: 0.7 });
export const paceMultiplier = group => PACE[group?.flight?.pace] ?? 1;

function isValidFlightPayload(p) {
  if (!p || typeof p !== "object") return false;
  const { overviewSceneId, map, to, origins, action } = p;
  if (typeof overviewSceneId !== "string") return false;
  if (typeof map?.src !== "string" || !Number.isFinite(map.width) || !Number.isFinite(map.height)) return false;
  if (map.width <= 0 || map.height <= 0) return false;
  if (action !== "view" && action !== "activate") return false;
  if (!Number.isFinite(p.pace) || p.pace < 0.5 || p.pace > 2) return false;
  if (p.sound !== null && !(typeof p.sound?.src === "string" && p.sound.src
    && Number.isFinite(p.sound.volume) && p.sound.volume >= 0 && p.sound.volume <= 1)) return false;
  if (!origins || typeof origins !== "object") return false;
  if (!Object.values(origins).every(o => o === null || isOutline(o))) return false;
  if (to?.kind === "map") return true;
  return to?.kind === "room" && typeof to.sceneId === "string" && typeof to.nodeId === "string"
    && isOutline(to.points) && (to.label == null || typeof to.label === "string");
}

/**
 * GM only. Moves the GM and every active player to a room or to the overview, flying.
 * Returns false without doing anything when it cannot fly this hop (target room has no Region, or
 * its node has no scene); the caller then takes its normal path. A call made while a flight is
 * still running is dropped and reports true, so the caller does not navigate a second time.
 * @param {{kind: "room", node: object} | {kind: "map"}} target
 * @returns {Promise<boolean>}
 */
export async function flyParty(target) {
  if (busy) return true;
  const group = getActiveGroup();
  const overview = getOverviewScene(group);
  if (!overview) return false;
  const rooms = getFlightRooms(group).linked;
  const action = game.settings.get(MODULE_ID, "guideModeAction");
  const socket = globalThis.ClickAdventure._socket;

  let to, sceneId, node = null;
  if (target.kind === "room") {
    node = target.node;
    const room = rooms.find(r => r.node.id === node.id);
    sceneId = getNodeActiveSceneId(node);
    if (!room || !sceneId || !game.scenes.get(sceneId)) return false;
    to = { kind: "room", nodeId: node.id, sceneId, label: node.label, points: room.points };
  } else {
    sceneId = overview.id;
    to = { kind: "map" };
  }

  busy = true;
  try {
    // Origins are read before any flag is written: afterwards every flag names the destination.
    const { nodes } = getGraphData();
    const users = [game.user, ...game.users.filter(u => !u.isGM && u.active)];
    const originNodes = new Map(users.map(u =>
      [u.id, nodes.find(n => n.id === u.getFlag(MODULE_ID, "currentNodeId")) ?? null]));
    const origins = Object.fromEntries(users.map(u =>
      [u.id, rooms.find(r => r.node.id === originNodes.get(u.id)?.id)?.points ?? null]));

    const payload = { overviewSceneId: overview.id, map: getOverviewMap(overview), to, origins, action, pace: paceMultiplier(group),
      sound: group.flight?.sound ?? null };
    socket.emitFlight(payload);
    const local = runFlight(payload);

    // The same state a non-flying Guide hop writes. Going to the map writes nothing: the overview
    // is not a node, and keeping currentNodeId on the last room lets the next room entered move
    // each token out of it and keeps the HUD's "came from" working.
    if (node) {
      const current = originNodes.get(game.user.id);
      if (current) await game.user.setFlag(MODULE_ID, "previousNodeId", current.id);
      else await game.user.unsetFlag(MODULE_ID, "previousNodeId");
      await setUserCurrentNode(game.user, node);
      for (const user of users.slice(1)) {
        const from = originNodes.get(user.id);
        await user.unsetFlag(MODULE_ID, "previousNodeId");
        await setUserCurrentNode(user, node);
        // GM is the executor — call directly (socket.io does not echo to emitter).
        await socket._handleMoveToken({
          userId: user.id,
          fromSceneId: from ? getNodeActiveSceneId(from) : null,
          toSceneId: sceneId
        });
      }
    }

    if (action === "activate") {
      await game.scenes.get(sceneId).activate({ viewOptions: { transition: { type: null } } });
    }
    await local;

    if (node) {
      await fireActiveItemMacro(node, "gm-view", sceneId);
      await fireNodeMacros(node, "gm-view");
      await openNodeJournal(node, "view");
      if (action === "activate") {
        await fireActiveItemMacro(node, "gm-activate", sceneId);
        await fireNodeMacros(node, "gm-activate");
        await openNodeJournal(node, "activate");
      }
      // No emitOpenJournal: each player opens its own after landing.
      socket.emitPlayerMoved(node.id);
    }
    const manager = foundry.applications.instances.get("manager-app");
    if (manager?.rendered) manager._patchOccupantAvatars();
    return true;
  } finally {
    busy = false;
  }
}

/** What this client's canvas shows right now, as a ViewFraming in map units. */
function currentOverviewView() {
  const d = canvas.scene.dimensions;
  const c = canvas.canvasCoordinatesFromClient({ x: innerWidth / 2, y: innerHeight / 2 });
  const a = canvas.clientCoordinatesFromCanvas({ x: 0, y: 0 });
  const b = canvas.clientCoordinatesFromCanvas({ x: 1000, y: 0 });
  return { kind: "view", x: c.x - d.sceneX, y: c.y - d.sceneY, scale: (b.x - a.x) / 1000 };
}

/**
 * Landing on the overview: pan the real canvas to the overlay's final framing, read back what
 * pan() actually allowed (it clamps through the scene's zoom limits), and let the overlay settle
 * onto that so the dissolve shows no jump.
 */
async function matchOverviewCamera(overlay, map) {
  const d = canvas.scene.dimensions;
  canvas.pan({ x: d.sceneX + map.width / 2, y: d.sceneY + map.height / 2, scale: mapScale(map.width, map.height) });
  await overlay.settle(currentOverviewView(), 150);
}

/** Resolves when this client's canvas has drawn `sceneId`, or after a timeout with a warning. */
function waitForCanvasScene(sceneId) {
  if (canvas.ready && canvas.scene?.id === sceneId) return Promise.resolve();
  return new Promise(resolve => {
    const id = Hooks.on("canvasReady", c => {
      if (c.scene?.id !== sceneId) return;
      Hooks.off("canvasReady", id);
      clearTimeout(timer);
      resolve();
    });
    const timer = setTimeout(() => {
      Hooks.off("canvasReady", id);
      console.warn(`Click Adventure | Flight landed before scene ${sceneId} finished loading.`);
      resolve();
    }, ARRIVAL_TIMEOUT_MS);
  });
}

/**
 * Views a scene with the core transition suppressed. Scene#view returns early, without drawing,
 * while another draw is still loading; when that happens, wait for that draw and ask once more.
 */
async function viewWithRetry(scene) {
  await scene.view({ transition: { type: null } });
  if (canvas.scene?.id === scene.id) return waitForCanvasScene(scene.id);
  if (canvas.loading) await new Promise(r => Hooks.once("canvasReady", r));
  await scene.view({ transition: { type: null } });
  return waitForCanvasScene(scene.id);
}

/** Every client: plays one flight described by a FLIGHT payload, if this user is in it. */
export async function runFlight(payload) {
  if (!isValidFlightPayload(payload)) {
    console.warn("Click Adventure | Dropped a malformed FLIGHT message.", payload);
    return;
  }
  const { overviewSceneId, map, to, origins, action, pace, sound } = payload;
  if (!(game.userId in origins)) return;
  const destSceneId = to.kind === "map" ? overviewSceneId : to.sceneId;
  const destScene = game.scenes.get(destSceneId);
  if (!destScene) return;

  const overlay = new FlightOverlay(map, { sound });
  try {
    await overlay.ready();
    // A client already on the overview starts from what its own camera shows; else from its room.
    const from = canvas.ready && canvas.scene?.id === overviewSceneId ? currentOverviewView()
      : origins[game.userId] ? { kind: "room", points: origins[game.userId] } : { kind: "map" };
    await overlay.cover(from, to.kind === "map" ? { kind: "map" } : { kind: "room", points: to.points, label: to.label });

    const arrived = action === "view" ? viewWithRetry(destScene) : waitForCanvasScene(destSceneId);
    await overlay.fly({ pace });
    await overlay.land({
      until: arrived.then(() => to.kind === "map" ? matchOverviewCamera(overlay, map) : null)
    });
  } catch (err) {
    console.error("Click Adventure | Flight failed:", err);
    overlay.destroy();
  }

  if (to.kind === "room" && !game.user.isGM) {
    const node = getGraphData().nodes.find(n => n.id === to.nodeId);
    if (node && action === "view") {
      await fireActiveItemMacro(node, "player-view", destSceneId);
      await fireNodeMacros(node, "player-view");
      await openNodeJournal(node, "view");
    } else if (node) {
      await openNodeJournal(node, "activate");
    }
  }
  if (globalThis.ClickAdventure._hud?.rendered) globalThis.ClickAdventure._hud.render({ force: true });
}

/** GM only: the #board double-click handler, live only on the active group's overview. */
export function onOverviewDoubleClick(event) {
  if (!flightAvailable() || !canvas.ready) return;
  const group = getActiveGroup();
  if (canvas.scene?.id !== getOverviewScene(group)?.id) return;
  // Editing Regions, or double-clicking a token (which opens its sheet), is not a travel order.
  if (canvas.regions?.active || canvas.tokens?.hover) return;
  const p = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
  const hit = getFlightRooms(group).linked.find(({ region }) => region.polygonTree.testPoint(p));
  if (hit) flyParty({ kind: "room", node: hit.node });
}
