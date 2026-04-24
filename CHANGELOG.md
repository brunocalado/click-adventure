# Changelog

## [0.1.3] - 2026-04-24
### Fixed
- Adventure tab panel now visible immediately on open when Adventure was the last active tab; previously the combobox was hidden until switching tabs and back, because `renderTileConfig` fires after AppV2's tab controller already ran (without finding our elements). Active state is now applied manually post-injection.
- Canvas click handler listeners were never registered: `registerTileClickHandler` runs inside the `ready` hook which fires after `canvasReady`, so the `canvasReady` subscription never triggered. Listeners are now attached immediately (canvas is already ready at that point) and also via the hook for subsequent scene loads.
- Adventure tab content is now inserted above the sheet footer instead of below the Update Tile button
- Canvas click handler now uses PIXI v7 FederatedPointerEvent API (direct `event.getLocalPosition`) instead of the removed `event.data` wrapper
- Tile hotspots are only active when the Tokens layer is the current layer, so GM tile editing on the Tiles layer is not intercepted
- Cursor changes to `pointer` when hovering over a configured hotspot
- Non-GM users navigate via `scene.view()` (they lack permission for `scene.activate()`)

## [0.1.1] - 2026-04-24
### Fixed
- Adventure tab now actually renders in the native TileConfig sheet by cloning the structure of existing tab buttons and including the `data-action="tab"` attribute required by AppV2 event delegation
- Tab content panel element type is matched to the sheet's existing panels (e.g. `<section>` vs `<div>`) so native tab activation toggles visibility correctly

## [0.1.0] - 2026-04-24
### Added
- Initial module structure targeting Foundry VTT v14
- Scene selector combobox injected as a new Adventure tab in the native Tile configuration sheet
- Canvas pointer handler to detect player clicks on configured tiles and activate the target scene

### Fixed
- Replaced deprecated `DocumentSheetConfig` global with tab injection via `renderTileConfig` hook
- Removed standalone `TileAdventureSheet` (DocumentSheetV2 subclass) — tab injection into native sheet is the correct v14 pattern for adding tabs to existing document sheets

### Removed
- i18n / localization support; all UI strings are hardcoded in English
- `lang/en.json` language file
