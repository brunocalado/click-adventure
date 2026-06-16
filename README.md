# 🗺️ Click Adventure

**Click Adventure** is a Foundry VTT module that transforms how your players explore the world. Instead of the GM manually jumping between scenes, you connect your locations into a visual map — and players navigate by clicking directional arrows on a stylish floating button, just like the classic point-and-click adventure games of old.

Perfect for narrative-heavy sessions where the *journey between places* is part of the story.

[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Donate-red?style=for-the-badge&logo=buy-me-a-coffee)](https://buymeacoffee.com/mestredigital)

---

## 🎬 See It in Action

[![Watch the video](https://img.youtube.com/vi/Fbc-q51kSKc/maxresdefault.jpg)](https://youtu.be/Fbc-q51kSKc)

> *Video is in Brazilian Portuguese, but the interface is fully visual — you'll get the idea instantly.*

---

## 📸 Screenshots

### The Scene Manager
Build your world by connecting scenes as nodes on a canvas. Drag them around, draw links, and define exactly where players can go.

![Node Manager](docs/node-manager.webp)

### The Navigation HUD
A sleek floating button appears on screen. Players click it to reveal directional arrows pointing to nearby locations — then pick where they want to go.

![Navigation HUD](docs/hud.webp)

### Node Configuration
Each location is fully configurable: multiple images, linked scenes, macros, autolock rules, and camera room settings — all in one panel.

![Node Settings](docs/node-settings.webp)

---

## ✨ Features

### 🧭 Navigation & Graph

- **Visual Scene Graph** — Place your scenes as nodes on an infinite canvas, draw directional links between them, and define every possible path through your adventure. Shift+click to multi-select nodes and drag them as a group; Ctrl+A selects all.
- **Navigation HUD** — A customizable floating button sits on screen during play. Clicking it fans out arrows pointing to all reachable destinations. Players just pick a direction.
- **Open & Gated Navigation** — In **Open** mode, players move freely. In **Gated** mode, each travel request goes to the GM for approval or rejection — with a bulk "Approve All" option for speed.
- **Per-Player Positions** — Every player tracks their own location in the graph independently. The Manager shows everyone's position live, in real time.
- **Scene Import from Folders** — Got your scenes organized in Foundry folders? Bulk-import an entire folder into the graph in one click.

---

### 🔗 Links

- **Five-Direction States** — Every link between nodes can be set to: **Bidirectional**, **Forward only**, **Backward only**, **Locked** (visible but impassable — shows a hint to players), or **Blocked** (hidden entirely; the GM sees it marked as secret).
- **Multi-Passage Links** — A single connection between two nodes can hold multiple named passages, each with its own direction and display. Simple links cycle direction on click; multi-passage links open a dedicated editor.
- **Peek Links** — A special link type drawn corner-to-corner (shown as a teal dashed line). Used by the Camera Room feature to let players silently observe other rooms without changing scenes.

---

### 🏠 Nodes

- **Multiple Background Images** — Attach several background images to a location. The GM can switch between them live from the HUD, and the change syncs to all players instantly via a managed tile in the scene.
- **Linked Scenes Per Node** — Associate more than one Foundry scene with a single node and swap between them during play — perfect for locations that look different at different times.
- **Node Macros** — Attach macros to a node with configurable triggers (GM View, GM Activate, or either) and execution modes (Always or Once). Compendium macros are automatically imported. A **Reset Macros** button re-enables once-fired macros.
- **Per-Node Autolock** — Override the global autolock setting per node: **Inherit**, **Open** (always unlock on arrival), or **Locked** (always lock on arrival).
- **Camera Rooms & Peek Links** — Mark any node as a Camera Room. Teal corner anchors appear on all nodes; drag corner-to-corner to create a peek link. Players inside a camera room see a **Cameras** button in their HUD — clicking a room swaps their background tile locally to show that room's image. No scene change, no broadcast. Resets on navigation.
- **Node Context Menu** — Right-click any node to set it as the active location, lock or unlock all players there, or delete it.
- **Occupant Badges** — Nodes display color-coded player badges so you can see at a glance who is where.

---

### 🎭 Adventure Groups

- **Multiple Adventure Graphs** — Organize your campaign into named **Groups**, each with its own independent scene graph. Switch between them at any time — activating a group moves all players to that group's starting node automatically.
- **Export & Import Adventures** — Export selected adventure groups to a portable JSON file. Import them into any world, with automatic scene creation and macro resolution by name. Great for sharing pre-built adventures or backing up your work.

---

### 🎮 GM Tools

- **GM Guide Mode** — Navigate in **Solo** (only your own view moves) or act as a **Guide** — pushing scene views to individual players or activating scenes globally. Toggle between modes directly from the HUD.
- **Player Panel** — The Manager shows all users (GM, online players, and offline players) with their current node, lock state, and user color at a glance.
- **Scene Sync Operations** — Bulk-create Foundry scenes for all nodes, or update existing scenes to sync their name, transition settings, and background tile with the current graph data.
- **Managed Background Tiles** — The module automatically creates and maintains a locked background tile in each scene to match the node's active image, without touching any GM-placed tiles.
- **Lock & Unlock Controls** — Lock all players at once from the toolbar, or lock/unlock individual players from the Player Panel. Lock state is saved and restored automatically when the game is paused and unpaused.
- **Visual Polls Integration** — When the [Visual Polls](https://github.com/brunocalado/visual-polls) module is active, a **Poll** button appears in the Manager toolbar. It opens a navigation vote for all online players, using destination images as thumbnails. Blocked and locked links are automatically excluded.

---

### 🎨 Player Experience

- **Scene Transition Effects** — Choose from 13 animated transitions applied when players navigate: Fade, Swirl, Water Drop, Morph, Crosshatch, Wind, Waves, White Noise, Hologram, Hole, Hole Swirl, Glitch, Dots — or None.
- **Player Autolock** — Prevent players from moving until the GM unlocks them. Lock state persists through pausing and resuming the game.
- **Default Token Spawn Positions** — Capture per-player token positions so characters land exactly where you want them when arriving at a new scene.
- **Player Location Whisper** — Players can see all other connected players listed in their HUD. Hovering the eye icon shows a tooltip preview of that player's current node image, even if they're in a different scene. Can be disabled via settings.

---

### 🎨 Customization

- **Customizable HUD Button** — Choose the shape (orb or square), color, optional custom image, and size of the navigation button, with a live preview in the settings panel.
- **HUD Visibility Control** — Show the HUD to all players or restrict it to GM only.
- **Settings Panel** — Configure transition type, HUD visibility, Guide Mode action, token position capture, and more — all in one place.
- **Built-in Instructions** — A help reference is always one click away from the Manager toolbar.

---

## 🚀 Opening the Manager

The Manager is the main interface where you build your scene graph. It's GM-only.

**Option 1 — Scene Directory button**

Open the **Scenes** tab in the sidebar. A **Click Adventure** button (and a **Groups** button) appear in the directory header. Click **Click Adventure** to open the Manager.

**Option 2 — Macro**

Create a script macro with the following code:

```js
ClickAdventure.Manager();
```

To open the Groups manager:

```js
ClickAdventure.Groups();
```

To open the navigation HUD manually:

```js
ClickAdventure.HUD();
```

---

## 📦 Building a Distributable Adventure Module

Want to package your adventure for others to use? See the [Wiki](https://github.com/brunocalado/click-adventure/wiki/Building-a-Distributable-Adventure-Module-for-Click-Adventure) for a full guide.

---

## 🔧 Manual Installation

1. Open Foundry VTT and go to **Add-on Modules**.
2. Click **Install Module**.
3. Paste the following manifest URL in the **Manifest URL** field at the bottom:

```
https://raw.githubusercontent.com/brunocalado/click-adventure/main/module.json
```

4. Click **Install** and wait for the process to complete.
5. Enable the module in your world via **Manage Modules**.

---

## 🤝 Recommended Modules

- **[Hide UI](https://github.com/brunocalado/hide-ui)** — Hide Foundry's default UI elements for a cleaner, more immersive adventure experience.
- **[Visual Polls](https://github.com/brunocalado/visual-polls)** — Enables the group navigation vote feature directly from the Manager toolbar.

---

## 🐛 Bug Reports & Feature Requests

Found a bug or have an idea? Open an issue on GitHub:

👉 https://github.com/brunocalado/click-adventure/issues

---

## 📄 License

This module is released under the [LICENSE](LICENSE) included in this repository.
