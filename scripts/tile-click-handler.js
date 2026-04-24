/**
 * registerTileClickHandler
 * Wires canvas pointer events so a tile with a Click Adventure target scene
 * becomes a navigable hotspot when the player is on the Tokens layer (the
 * default play layer). On the Tiles layer the GM retains normal editing
 * behavior and clicks are ignored by this module.
 *
 * PIXI v7 (used by Foundry v14) exposes the FederatedPointerEvent directly —
 * there is no longer an `event.data` wrapper; `event.getLocalPosition(target)`
 * returns coordinates in the target's local space.
 */
export function registerTileClickHandler() {
  Hooks.on("canvasReady", () => {
    if (!canvas?.stage) return;
    canvas.stage.off("pointermove", _onCanvasPointerMove);
    canvas.stage.off("pointerdown", _onCanvasPointerDown);
    canvas.stage.on("pointermove", _onCanvasPointerMove);
    canvas.stage.on("pointerdown", _onCanvasPointerDown);
  });

  Hooks.on("canvasTearDown", () => {
    _resetCursor();
  });
}

/**
 * The module should only intercept clicks when the player is on the Tokens
 * layer — any other layer (Tiles, Walls, Lighting, etc.) uses the native
 * interaction model.
 */
function _isPlayLayerActive() {
  return canvas?.activeLayer === canvas?.tokens;
}

function _onCanvasPointerMove(event) {
  if (!_isPlayLayerActive()) {
    _resetCursor();
    return;
  }
  const point = event.getLocalPosition(canvas.tiles);
  const tile = _getAdventureTileAt(point);
  _setCursor(tile ? "pointer" : "");
}

function _onCanvasPointerDown(event) {
  if (!_isPlayLayerActive()) return;
  if (event.button !== 0) return;

  const point = event.getLocalPosition(canvas.tiles);
  const tile = _getAdventureTileAt(point);
  if (!tile) return;

  event.stopPropagation();
  _handleTileClick(tile.document);
}

/**
 * Find the topmost Click Adventure tile under a canvas-local point.
 * Iterates in reverse so the visually-topmost tile wins, and skips hidden
 * tiles so GM-only scenery doesn't capture player clicks.
 */
function _getAdventureTileAt(point) {
  const tiles = canvas.tiles?.placeables ?? [];
  for (let i = tiles.length - 1; i >= 0; i--) {
    const tile = tiles[i];
    if (tile.document.hidden && !game.user.isGM) continue;
    if (!tile.document.getFlag("click-adventure", "targetSceneId")) continue;

    const { x, y, width, height } = tile.document;
    if (point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height) {
      return tile;
    }
  }
  return null;
}

function _setCursor(value) {
  const view = canvas?.app?.view;
  if (view) view.style.cursor = value;
}

function _resetCursor() {
  _setCursor("");
}

/**
 * Navigate to the tile's target scene. GMs activate the scene for everyone;
 * non-GMs can only view it for themselves (scene.activate requires permission).
 */
async function _handleTileClick(tileDoc) {
  const targetSceneId = tileDoc.getFlag("click-adventure", "targetSceneId");
  if (!targetSceneId) return;

  const scene = game.scenes.get(targetSceneId);
  if (!scene) {
    console.warn(`Click Adventure | Target scene ${targetSceneId} not found.`);
    return;
  }

  if (game.user.isGM) await scene.activate();
  else await scene.view();
}
