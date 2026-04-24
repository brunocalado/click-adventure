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

/**
 * Hook: renderTileConfig / renderTileConfigV2
 * V14 uses ApplicationV2 render hooks, but the concrete class name for the
 * tile configuration sheet may differ between core versions. To be robust,
 * listen to both possible hook names and normalize the HTML argument to an
 * HTMLElement before injecting our tab.
 */
function handleRenderTileConfig(app, html) {
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root) return;
  injectAdventureTab(app, root);
}

Hooks.on("renderTileConfig", handleRenderTileConfig);
Hooks.on("renderTileConfigV2", handleRenderTileConfig);
