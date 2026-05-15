# Click Adventure

Click Adventure is a Foundry VTT module that lets you build point-and-click style navigation for your tabletop adventures. Instead of jumping between scenes manually, you connect your scenes into a visual map — and your players explore them by clicking directional arrows on a floating HUD, just like classic adventure games. It is designed for narrative-heavy sessions where the journey through locations is part of the story.

---

## Features

- **Visual Scene Graph** — Connect your scenes as nodes on a canvas, drawing directional links between them to define where players can go.
- **Navigation HUD** — A floating button appears on screen for players in adventure scenes. Clicking it reveals arrows pointing to reachable destinations.
- **Open & Gated Navigation** — In Open mode, players move freely. In Gated mode, players must request permission and the GM approves or rejects each move.
- **GM Guide Mode** — The GM can navigate solo (only their own view moves) or act as a guide, pushing scene views to individual players or activating scenes globally.
- **Per-Player Positions** — Each player tracks their own current location in the graph independently.
- **Customizable HUD Button** — Choose the style (orb or custom image), color, and size of the navigation button.
- **HUD Visibility Control** — Restrict the HUD to GM only, or show it to all players.
- **Default Token Spawn Positions** — Capture per-player token positions so characters land in the right spot when navigating to a new scene.
- **Player Autolock** — Optionally prevent players from moving until unlocked by the GM.
- **Scene Import from Folders** — Bulk-add scenes from a Foundry scene folder directly into the graph.

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

---

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
