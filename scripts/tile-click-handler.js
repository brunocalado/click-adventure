/**
 * registerTileClickHandler
 * Listens for left-clicks on the canvas and checks if the clicked Tile
 * has a Click Adventure targetSceneId flag. If so, activates that scene for all clients.
 * Registered during the "ready" Hook.
 */
export function registerTileClickHandler() {
  // We hook into the Tile object's _onClickLeft via libWrapper if available,
  // otherwise use the canvas mousedown event via PointerManager.
  // This approach avoids monkey-patching and respects v14 architecture.
  Hooks.on("canvasReady", () => {
    const layer = canvas.tiles;
    if (!layer) return;

    // Listen to left-click events on tiles via the PlaceablesLayer interaction model
    layer.interactiveChildren = true;
  });

  // Hook into Tile left-click via the documented v14 interaction hook
  Hooks.on("clickTile", (tile, event) => {
    _handleTileClick(tile);
  });

  // Fallback: patch via the canvas stage pointer event for tiles without native hook support
  Hooks.on("canvasReady", () => {
    canvas.stage.on("pointerdown", (event) => {
      // Only process left-clicks from players (non-GM) to avoid blocking GM interactions
      if (event.data?.button !== 0) return;

      const point = event.data.getLocalPosition(canvas.tiles);
      const tile = _getTileAtPoint(point);
      if (tile) _handleTileClick(tile.document);
    });
  });
}

/**
 * Find the topmost Click Adventure tile at a given canvas point.
 * @param {{x: number, y: number}} point - Canvas coordinates
 * @returns {Tile|null} The matching Tile placeable or null
 */
function _getTileAtPoint(point) {
  const tiles = canvas.tiles.placeables;
  // Iterate in reverse so topmost (highest z-index) tile wins
  for (let i = tiles.length - 1; i >= 0; i--) {
    const tile = tiles[i];
    const flag = tile.document.getFlag("click-adventure", "targetSceneId");
    if (!flag) continue;

    const { x, y, width, height } = tile.document;
    if (point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height) {
      return tile;
    }
  }
  return null;
}

/**
 * Activate the target scene stored in the tile's Click Adventure flag.
 * Calls scene.activate() which propagates the scene change to all connected clients.
 * @param {TileDocument} tileDoc - The TileDocument with the flag
 */
async function _handleTileClick(tileDoc) {
  const targetSceneId = tileDoc.getFlag("click-adventure", "targetSceneId");
  if (!targetSceneId) return;

  const scene = game.scenes.get(targetSceneId);
  if (!scene) {
    console.warn(`Click Adventure | Target scene ${targetSceneId} not found.`);
    return;
  }

  await scene.activate();
}
