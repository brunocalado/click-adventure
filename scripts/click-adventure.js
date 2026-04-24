/**
 * Click Adventure - Main entry point
 * Registers hooks on init and ready to extend Tile sheets and handle click navigation.
 */
import { TileAdventureSheet } from "./tile-adventure-sheet.js";
import { registerTileClickHandler } from "./tile-click-handler.js";

// Hook: init - register the custom Tile sheet tab via DocumentSheetV2 extension
Hooks.once("init", () => {
  console.log("Click Adventure | Initializing module");

  // Register TileAdventureSheet as an additional config sheet for Tile documents
  DocumentSheetConfig.registerSheet(TileDocument, "click-adventure", TileAdventureSheet, {
    makeDefault: false,
    label: "CLICK_ADVENTURE.SheetLabel"
  });
});

// Hook: ready - attach click handlers to the canvas for adventure tile navigation
Hooks.once("ready", () => {
  registerTileClickHandler();
});
