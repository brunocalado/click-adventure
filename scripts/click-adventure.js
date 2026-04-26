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
 * One-time migration: wrap the legacy flat `direction` field on each link into a
 * single-element `passages` array so all downstream code can rely on the new schema.
 * Runs in the `ready` hook (after world data is available) and only writes if any
 * link still has the old shape.  Only GMs can write world-scope settings.
 */
Hooks.on("ready", async () => {
  if (!game.user.isGM) return;
  const graph = game.settings.get("click-adventure", "graph");
  const raw = typeof graph?.toObject === "function" ? graph.toObject() : (graph ?? {});
  const links = raw.links ?? [];

  const needsMigration = links.some(l => !Array.isArray(l.passages));
  if (!needsMigration) return;

  const migratedLinks = links.map(l => {
    if (Array.isArray(l.passages)) return l;
    const { direction, ...rest } = l;
    return { ...rest, passages: [{ label: "", direction: direction ?? "both" }] };
  });

  await game.settings.set("click-adventure", "graph", { ...raw, links: migratedLinks });
  console.log("[ClickAdventure] Migrated links to passages[] schema.");
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
