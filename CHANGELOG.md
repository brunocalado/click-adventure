# Changelog

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
