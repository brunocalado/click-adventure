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

/**
 * Automatically show or hide the NavHUD based on whether the active scene
 * was created by Click Adventure (identified by its flag).
 * Triggered by the canvasReady hook, which fires after every scene activation
 * and initial load, once the canvas is fully initialized.
 */
Hooks.on("canvasReady", () => {
  const scene = game.scenes.active;
  const isAdventureScene = scene?.flags?.["click-adventure"]?.isAdventureScene === true;

  if (isAdventureScene) {
    ClickAdventure.Hud();
  } else {
    if (globalThis.ClickAdventure._hud?.rendered) {
      globalThis.ClickAdventure._hud.close();
    }
  }
});

/**
 * Seeds this user's per-user currentNodeId flag from startNodeId on first load.
 * Runs for every user (GM and players alike) — each gets their own independent flag.
 * Only writes when the user has no position yet and a startNodeId is defined.
 */
Hooks.on("ready", async () => {
  const graph = game.settings.get("click-adventure", "graph");
  const raw = typeof graph?.toObject === "function" ? graph.toObject() : (graph ?? {});
  const existing = game.user.getFlag("click-adventure", "currentNodeId");
  if (!existing && raw.startNodeId) {
    await game.user.setFlag("click-adventure", "currentNodeId", raw.startNodeId);
  }
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

  game.settings.register("click-adventure", "transitionType", {
    name: "Scene Transition Type",
    scope: "world",
    config: false,
    type: String,
    default: "null"
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
