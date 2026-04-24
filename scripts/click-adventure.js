/**
 * Click Adventure - Main entry point
 * Registers hooks on init and ready to extend Tile sheets and handle click navigation.
 */
import { injectAdventureTab } from "./tile-adventure-tab-injector.js";
import { registerTileClickHandler } from "./tile-click-handler.js";

Hooks.once("init", () => {
  console.log("Click Adventure | Initializing module");
});

Hooks.once("ready", () => {
  registerTileClickHandler();
});

// Hook: renderTileConfig fires each time the native Tile sheet renders in v14 AppV2
Hooks.on("renderTileConfig", (app, html) => {
  const root = html instanceof HTMLElement ? html : html[0];
  injectAdventureTab(app, root);
});
