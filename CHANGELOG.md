# Changelog

## [0.1.0] - 2026-04-24
### Added
- Initial module structure targeting Foundry VTT v14
- `TileAdventureSheet` extending `DocumentSheetV2` with a dedicated Adventure tab
- Scene selector combobox in Tile configuration to assign a navigation target
- Canvas pointer handler to detect player clicks on configured tiles and activate the target scene

### Removed
- i18n / localization support; all UI strings are now hardcoded in English
- `lang/en.json` language file
