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
 *
 * Timing note: `registerTileClickHandler` is called from the `ready` hook,
 * which fires AFTER `canvasReady`. Waiting for `canvasReady` again would never
 * trigger. We therefore attach immediately if canvas is already ready, and also
 * subscribe to future `canvasReady` events for subsequent scene loads.
 */
export function registerTileClickHandler() {
  function attachListeners() {
    if (!canvas?.stage) return;
    canvas.stage.off("pointermove", _onCanvasPointerMove);
    canvas.stage.off("pointerdown", _onCanvasPointerDown);
    canvas.stage.on("pointermove", _onCanvasPointerMove);
    canvas.stage.on("pointerdown", _onCanvasPointerDown);
  }

  // Subscribe for future scene loads.
  Hooks.on("canvasReady", attachListeners);

  // Attach immediately — canvas is already ready when `ready` fires.
  attachListeners();

  Hooks.on("canvasTearDown", _resetCursor);
}

/**
 * Only intercept clicks while the Tokens layer is active.
 * Any other layer (Tiles, Walls, Lighting…) uses native Foundry interaction.
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
  _setCursor(_getAdventureTileAt(point) ? "pointer" : "");
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
 * Skips hidden tiles for non-GM users so GM-only scenery is not interactive.
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
 * Navigate to the tile's target scene. GMs activate for everyone;
 * players view the scene for themselves (scene.activate requires GM permission).
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
