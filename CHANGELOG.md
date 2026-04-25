## [Unreleased]

### [Added]
- `ClickAdventure.Manager()` — opens a resizable scene-graph window where nodes (scenes) can be placed, labelled, and linked with directional arrows.
- `AdventureDataModel` — `foundry.abstract.DataModel` backing nodes + links, persisted as a world-scoped module setting (`click-adventure.graph`).
- `ManagerApp` — `ApplicationV2` + `HandlebarsApplicationMixin` graph workspace with drag-to-reposition nodes, anchor-dot link drawing, and live SVG link redraw.
- `NodeConfigApp` — `ApplicationV2` per-node config panel with label editing and Foundry FilePicker image selection.
- `styles/click-adventure.css` — dark-theme workspace, node cards, anchor dots, SVG link/temp-link rules, and node-config panel styles.
