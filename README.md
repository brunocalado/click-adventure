# Click Adventure

Click Adventure is a Foundry VTT module that lets you build point-and-click style navigation for your tabletop adventures. Instead of jumping between scenes manually, you connect your scenes into a visual map — and your players explore them by clicking directional arrows on a floating HUD, just like classic adventure games. It is designed for narrative-heavy sessions where the journey through locations is part of the story.

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Donate-red?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/mestredigital)

---

## Features

### Navigation & Graph

- **Visual Scene Graph** — Connect your scenes as nodes on a canvas, drawing directional links between them to define where players can go. Shift+click to multi-select nodes and drag them as a group; Ctrl+A selects all.
- **Navigation HUD** — A floating button appears on screen for players in adventure scenes. Clicking it reveals arrows pointing to reachable destinations.
- **Open & Gated Navigation** — In Open mode, players move freely. In Gated mode, players submit a travel request that the GM approves or rejects individually, with a bulk "Approve All" option.
- **Per-Player Positions** — Each player tracks their own current location in the graph independently, shown live in the Manager's player panel.
- **Scene Import from Folders** — Bulk-add scenes from a Foundry scene folder directly into the graph.

### Links

- **Five-Direction Link States** — Each link between nodes can be set to Bidirectional, Forward only, Backward only, Locked (visible but impassable, shows a hint to players), or Blocked (hidden from players entirely; GMs see it marked as secret).
- **Multi-Passage Links** — A single link between two nodes can carry multiple named passages, each with its own direction state and display mode. Simple links cycle direction on click; multi-passage links open a dedicated editor.

### Nodes

- **Multi-Image Per Node** — Attach multiple background images to a node. The GM can switch between them live from the HUD, and the active image is synced to a managed background tile in the Foundry scene.
- **Linked Scenes Per Node** — Associate multiple Foundry scenes with a single node and switch between them during play, useful for nodes that change their visual representation.
- **Node Macros** — Attach macros to a node with configurable triggers (GM View, GM Activate, or either) and execution modes (Always or Once). Compendium macros are imported automatically. A Reset Macros button re-enables once-fired macros.
- **Per-Node Autolock** — Override the global autolock setting on individual nodes: Inherit, Open (always unlock on arrival), or Locked (always lock on arrival).
- **Node Context Menu** — Right-click any node in the Manager to set it as the active node, lock or unlock players at that location, or delete it.

### GM Tools

- **GM Guide Mode** — The GM can navigate Solo (only their own view moves) or act as a Guide, pushing scene views to individual players or activating scenes globally. Toggle between modes directly from the HUD.
- **Player Panel** — The Manager displays all users — GM, online players, offline players — with their current node, lock state, and user color shown at a glance.
- **Occupant Badges** — Nodes display color-coded badges showing which players are currently located there.
- **Scene Sync Operations** — Bulk-create Foundry scenes for all nodes, or update existing scenes to sync their name, transition settings, and background tile with the current graph data.
- **Managed Background Tiles** — The module automatically creates and updates a locked background tile in each scene to match the node's active image, without touching GM-placed tiles.

### Player Experience

- **Scene Transition Effects** — Choose from 13 animated transition effects (Fade, Swirl, Water Drop, Morph, Crosshatch, Wind, Waves, White Noise, Hologram, Hole, Hole Swirl, Glitch, Dots, or None) applied when navigating between scenes.
- **Player Autolock** — Optionally prevent players from moving until unlocked by the GM. The lock state is saved and restored automatically when the game is paused and unpaused.
- **Default Token Spawn Positions** — Capture per-player token positions so characters land in the right spot when navigating to a new scene.
- **Player Location Whisper** — Players can see all other connected players listed in their HUD. Hovering the eye icon next to a name shows a tooltip preview of the node image where that player currently is, even if they are in a different scene. Can be disabled via the Show Player Locations setting.

### Customization

- **Customizable HUD Button** — Choose the shape (orb or square), color, optional custom image, and size of the navigation button, with a live preview.
- **HUD Visibility Control** — Restrict the HUD to GM only, or show it to all players.
- **Settings Panel** — A dedicated settings interface for transition type, HUD visibility, Guide Mode action (View or Activate), and token position capture.
- **Instructions Panel** — A built-in help reference accessible directly from the Manager toolbar.

---

## Opening the Manager

The Manager is the main interface where you build and configure your scene graph. It is accessible to the GM only.

**Option 1 — Scene Directory button**

Open the **Scenes** tab in the sidebar. A **Click Adventure** button appears in the directory header. Click it to open the Manager.

**Option 2 — Macro**

Create a script macro with the following code and click it to open the Manager:

```js
ClickAdventure.Manager();
```

To open the navigation HUD manually:

```js
ClickAdventure.HUD();
```

This will allow to create groups.
```js
ClickAdventure.Groups();
```

---

## Building a Distributable Adventure Module for Click Adventure

[WIKI](https://github.com/brunocalado/click-adventure/wiki/Building-a-Distributable-Adventure-Module-for-Click-Adventure).


## Manual Installation

1. Open Foundry VTT and go to **Add-on Modules**.
2. Click **Install Module**.
3. Paste the following manifest URL in the **Manifest URL** field at the bottom:

```
https://raw.githubusercontent.com/brunocalado/click-adventure/main/module.json
```

4. Click **Install** and wait for the process to complete.
5. Enable the module in your world via **Manage Modules**.

---

## Bug Reports & Feature Requests

Found a bug or have an idea for a new feature? Open an issue on GitHub:

https://github.com/brunocalado/click-adventure/issues

---

## License

This module is released under this [LICENSE](LICENSE).
