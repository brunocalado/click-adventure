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

Hooks.on("init", () => {
  game.settings.register("click-adventure", "graph", {
    name: "Adventure Graph",
    scope: "world",
    config: false,
    type: AdventureDataModel,
    default: { sceneId: "", currentNodeId: "", nodes: [], links: [] }
  });

  globalThis.ClickAdventure = {
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
    _hud: null
  };
});
