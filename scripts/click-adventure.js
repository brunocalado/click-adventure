/**
 * Module entry point for Click Adventure.
 *
 * Registers the `click-adventure.graph` world setting backed by AdventureDataModel
 * and exposes the public API on `globalThis.ClickAdventure` during the `init` hook.
 *
 * Usage from the Foundry console:
 *   ClickAdventure.Manager()
 */

import { AdventureDataModel } from "./adventure-data-model.js";
import { ManagerApp } from "./manager-app.js";
import { NavHudApp } from "./nav-hud-app.js";
import { AdventureSocketManager } from "./socket-manager.js";
import { getGraphData } from "./node-utils.js";
import { HudStyleApp } from "./hud-style-app.js";

/**
 * Returns true if the given sceneId belongs to any node in the current graph.
 * Used to decide whether to show the HUD regardless of the scene flag.
 * @param {string|null} sceneId
 * @returns {boolean}
 */
function _isGraphScene(sceneId) {
  if (!sceneId) return false;
  const { nodes } = getGraphData();
  return nodes.some(n => n.sceneId === sceneId);
}

/**
 * Show or hide the NavHUD based on the scene currently in view.
 * Uses canvas.scene (the viewed scene) rather than game.scenes.active so that
 * "View Scene" in the scene manager also triggers the HUD correctly.
 * Triggered by the canvasReady hook, which fires on every canvas load/switch.
 */
Hooks.on("canvasReady", () => {
  const scene = canvas.scene;
  const byFlag = scene?.flags?.["click-adventure"]?.isAdventureScene === true;
  const byGraph = _isGraphScene(scene?.id);

  const hudVisibility = game.settings.get("click-adventure", "hudVisibility");
  const canSeeHud = game.user.isGM || hudVisibility === "all";

  if ((byFlag || byGraph) && canSeeHud) {
    ClickAdventure.Hud();
  } else {
    if (globalThis.ClickAdventure._hud?.rendered) {
      globalThis.ClickAdventure._hud.close();
    }
  }
});

/**
 * Re-evaluate HUD visibility whenever the graph setting changes.
 * Covers the case where scenes are created/synced and the current canvas
 * view is already a graph scene (canvasReady won't fire again).
 */
Hooks.on("updateSetting", (setting) => {
  if (setting.key !== "click-adventure.graph") return;
  const scene = canvas?.scene;
  if (!scene) return;

  const hudVisibility = game.settings.get("click-adventure", "hudVisibility");
  const canSeeHud = game.user.isGM || hudVisibility === "all";

  const { nodes } = getGraphData();
  const belongs = nodes.some(n => n.sceneId === scene.id);

  if (belongs && canSeeHud && !globalThis.ClickAdventure._hud?.rendered) {
    // HUD is not open yet but this scene is now part of the graph — open it.
    ClickAdventure.Hud();
  } else if (globalThis.ClickAdventure._hud?.rendered) {
    // HUD is already open — re-render so the destination list reflects the new graph.
    globalThis.ClickAdventure._hud.render({ force: true });
  }
});

/**
 * Immediately apply hudVisibility changes without requiring a canvas reload.
 * Closes non-GM HUDs when the GM switches to "gm-only", and re-opens them
 * when switching back to "all" if the current scene qualifies.
 */
Hooks.on("updateSetting", (setting) => {
  if (setting.key !== "click-adventure.hudVisibility") return;

  const hudVisibility = game.settings.get("click-adventure", "hudVisibility");
  const canSeeHud = game.user.isGM || hudVisibility === "all";

  if (!canSeeHud && globalThis.ClickAdventure._hud?.rendered) {
    globalThis.ClickAdventure._hud.close();
  } else if (canSeeHud && !globalThis.ClickAdventure._hud?.rendered) {
    const scene = canvas?.scene;
    if (!scene) return;
    const byFlag = scene?.flags?.["click-adventure"]?.isAdventureScene === true;
    const byGraph = _isGraphScene(scene?.id);
    if (byFlag || byGraph) ClickAdventure.Hud();
  }
});

Hooks.on("updateSetting", (setting) => {
  if (setting.key !== "click-adventure.orbStyle") return;
  if (globalThis.ClickAdventure._hud?.rendered) {
    globalThis.ClickAdventure._hud.render({ force: true });
  }
});

/**
 * Seeds this user's per-user currentNodeId flag from startNodeId on first load,
 * then restores the correct scene view based on the saved node position.
 * Runs for every user (GM and players alike) — each gets their own independent flag.
 * Only seeds when the user has no position yet and a startNodeId is defined.
 * Only calls scene.view() when the currently viewed canvas scene differs from the
 * node's scene, avoiding a redundant reload when the user is already in the right place.
 */
Hooks.on("ready", async () => {
  const { startNodeId, nodes } = getGraphData();
  const existing = game.user.getFlag("click-adventure", "currentNodeId");

  // Seed position on first visit (no flag set yet)
  if (!existing && startNodeId) {
    await game.user.setFlag("click-adventure", "currentNodeId", startNodeId);
  }

  // Resolve the node the user is currently at (after potential seed above)
  const currentNodeId = game.user.getFlag("click-adventure", "currentNodeId");
  if (!currentNodeId) return;

  const node = nodes.find(n => n.id === currentNodeId);
  if (!node?.sceneId) return;

  // Only switch view if the canvas is not already showing the correct scene.
  // This avoids a redundant scene.view() call when the user happens to reload
  // while already on their node's scene.
  if (canvas?.scene?.id === node.sceneId) return;

  const scene = game.scenes.get(node.sceneId);
  if (!scene) return;

  await scene.view();
});

Hooks.on("init", () => {
  Handlebars.registerHelper("eq", (a, b) => a === b);

  // Returns a Unicode glyph for a passage direction value.
  Handlebars.registerHelper("caDirectionIcon", dir => {
    const icons = { both: "⟷", forward: "→", backward: "←", blocked: "✕" };
    return icons[dir] ?? "⟷";
  });

  game.settings.register("click-adventure", "graph", {
    name: "Adventure Graph",
    scope: "world",
    config: false,
    type: AdventureDataModel,
    default: { sceneId: "", startNodeId: "", nodes: [], links: [] }
  });

  game.settings.register("click-adventure", "navigationMode", {
    name: "Navigation Mode",
    hint: "Open: players navigate freely. Gated: players must request GM approval.",
    scope: "world",
    config: false,
    type: String,
    default: "open",
    choices: { open: "Open Navigation", gated: "Gated Navigation" }
  });

  game.settings.register("click-adventure", "managerPan", {
    name: "Manager Pan Position",
    scope: "client",
    config: false,
    type: Object,
    default: { x: 0, y: 0 }
  });

  game.settings.register("click-adventure", "transitionType", {
    name: "Scene Transition Type",
    scope: "world",
    config: false,
    type: String,
    default: "null"
  });

  game.settings.register("click-adventure", "guideModeAction", {
    name: "Guide Mode Action",
    hint: "View: sends each player to the scene individually. Activate: activates the scene globally (Foundry handles view for all connected users).",
    scope: "world",
    config: false,
    type: String,
    default: "view",
    choices: { view: "View (per-player)", activate: "Activate (global)" }
  });

  game.settings.register("click-adventure", "hudVisibility", {
    name: "HUD Visibility",
    hint: "Controls who sees the navigation HUD.",
    scope: "world",
    config: false,
    type: String,
    default: "all",
    choices: { all: "All players", "gm-only": "GM only" }
  });

  game.settings.register("click-adventure", "orbStyle", {
    name: "HUD Button Style",
    hint: "Visual appearance of the navigation HUD button. Configured by the GM; applies to all players.",
    scope: "world",
    config: false,
    type: Object,
    default: { type: "orb", size: 1, color: "#3355aa", orbImage: "" }
  });

  game.settings.register("click-adventure", "defaultTokenPositions", {
    name: "Default Token Positions",
    hint: "Stores per-user default token spawn coordinates. Managed via the Settings panel in the Manager.",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register("click-adventure", "useDefaultTokenPositions", {
    name: "Use Default Token Positions",
    hint: "When enabled, teleported tokens spawn at the captured positions instead of scene center.",
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.registerMenu("click-adventure", "orbStyleMenu", {
    name: "HUD Button Style",
    label: "Customize HUD Button Style…",
    hint: "Configure the visual appearance of the navigation HUD button. Only the GM can change this; changes apply to all players.",
    icon: "fa-regular fa-circle",
    type: HudStyleApp,
    restricted: true
  });

  // Instantiate socket manager — must run during init so the listener
  // is registered before any socket messages can arrive.
  const socketManager = new AdventureSocketManager();

  globalThis.ClickAdventure = {
    /** @type {typeof ManagerApp} — exposed so socket-manager can instantiate it. */
    ManagerApp,

    /**
     * Opens the scene-graph manager window, or brings the existing one to front.
     * @returns {ManagerApp}
     */
    Manager: () => {
      if (globalThis.ClickAdventure._manager?.rendered) {
        globalThis.ClickAdventure._manager.render();
        return globalThis.ClickAdventure._manager;
      }
      const app = new ManagerApp();
      globalThis.ClickAdventure._manager = app;
      app.render(true);
      return app;
    },

    /** @type {ManagerApp|null} — active instance, kept for cross-app refresh. */
    _manager: null,

    /**
     * Opens the floating navigation HUD, or brings the existing one to front.
     * @returns {NavHudApp}
     */
    Hud: () => {
      if (globalThis.ClickAdventure._hud?.rendered) {
        globalThis.ClickAdventure._hud.render();
        return globalThis.ClickAdventure._hud;
      }
      const hud = new NavHudApp();
      globalThis.ClickAdventure._hud = hud;
      hud.render(true);
      return hud;
    },

    /** @type {NavHudApp|null} — active HUD instance. */
    _hud: null,

    /** @type {AdventureSocketManager} — socket handler instance */
    _socket: socketManager
  };
});
