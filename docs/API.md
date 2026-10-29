# Click Adventure API

This page is for macro writers and developers of other modules. If you only want to run an adventure, the [README](../README.md) and the Instructions window (Manager toolbar) cover everything.

Click Adventure has no build step and no dependencies. It is plain ES modules loaded from `scripts/index.js`, and it runs on Foundry VTT v14.

## The global object

The module puts its API on `globalThis.ClickAdventure` during the `init` hook, so it is there from `setup` onwards and in any macro.

| Call | Who | What it does |
|---|---|---|
| `ClickAdventure.Manager()` | GM | Opens the scene graph Manager, or brings the open one to the front. Returns the app. |
| `ClickAdventure.Groups()` | GM | Opens the Groups manager, or brings it to the front. Returns the app. |
| `ClickAdventure.HUD()` | anyone | Opens the navigation HUD, or re-renders the open one. Returns the app. |
| `ClickAdventure.Flight.apply(data, options)` | GM | Creates or updates a group's overview map and rooms. See [Flight over the map](#flight-over-the-map). |
| `ClickAdventure.Flight.read(options)` | anyone | Returns a group's overview setup in the units `apply()` takes. |
| `ClickAdventure.Flight.preview(args)` | anyone | Plays one flight locally over a map image, for checking how it looks. |

Anything on the object whose name starts with `_` (`_socket`, `_manager`, `_hud`, `_groups`) and the exposed `ManagerApp` class are internals. They change without notice, so don't build on them.

The module fires no hooks of its own.

## Macros run by Click Adventure

Click Adventure runs your macros in three places. It always calls `macro.execute()` with no arguments, so a macro reads what it needs from Foundry itself: `game.user`, `game.user.character`, `canvas.scene`.

### Arrival macros

Macros attached to a node, an image or a linked scene fire when someone arrives, according to their trigger:

| Trigger | Runs on |
|---|---|
| GM View | the GM's client, when the GM views the scene |
| GM Activate | the GM's client, when the scene is activated |
| GM View/Activate | the GM's client, on either of the two |
| Player View | the player's own client, when that player arrives |

They fire on arrival however the player got there: the HUD, a GM teleport, or an approved request in Gated mode. A macro set to *Once* is marked as run and skipped after that, until **Reset Macros**.

A *Player View* macro runs with the player's permissions. The player needs at least Observer ownership of the macro, and their role must be allowed to use script macros in **Configure Permissions**. A GM-side trigger never runs on a player's client.

Errors are caught and logged to the console, so a broken macro doesn't stop the move.

### Key macros

A Custom passage can use a macro as a key. It runs on the client of the player trying to cross, at the moment they click the destination, never while the HUD merely draws. The key counts only when the macro resolves to exactly `true`:

```js
// Key macro: only a character with at least 3 Wisdom passes.
const actor = game.user.character;
return (actor?.system.abilities?.wis?.value ?? 0) >= 3;
```

A script whose last line is `true;` without `return` resolves to `undefined`, and a chat macro resolves to a ChatMessage. Neither counts. If the player can't run the macro (ownership below Observer), the key fails and a warning saying so goes to the console. The GM always bypasses keys.

## Flight over the map

A group can have an overview map: a Scene the module creates at the map image's exact size, with no padding and no grid, so image pixels and scene coordinates are the same. Each room is a GM-only Region on that scene, and a node is linked to a Region by its id, or else by a tolerant name match ("4. Ballroom" matches "Ballroom"; case, accents and punctuation are ignored).

The Regions are the only copy of the room geometry. You can draw and fix them by hand with Foundry's Region tools, or write them from data with `apply()`. Both end up in the same place.

### `Flight.apply(data, { groupId })`

GM only. `groupId` defaults to the active group.

```js
const report = await ClickAdventure.Flight.apply({
  map: "worlds/my-world/maps/manor.webp",   // needed only when the group has no overview yet
  rooms: [
    { name: "Ballroom", points: [[120, 340], [610, 300], [650, 720], [140, 760]] },
    { name: "3a. Entry", node: "Entry Hall", points: [900, 1200, 1300, 1180, 1320, 1500, 880, 1520] }
  ]
});
```

- `points` are in pixels of the map image, as `[[x, y], …]` pairs or a flat `[x0, y0, x1, y1, …]` array, with at least three points.
- `node` is optional. Without it, the room links to the node with the matching name. With it, it links to the node with that label.
- `size: { width, height }` is optional. When given, the overview is created at that size instead of reading it from the image, which is how an import rebuilds an overview whose map file is missing.

Rooms are matched to existing Regions by exact name, so running `apply()` again replaces their shapes in place. Colour, visibility and other changes made by hand are kept, and Regions not named in the data are left alone. When the group already has an overview, a different `map` is ignored (`report.mapIgnored` is `true`). Change the map from the Flight card in Settings instead.

It throws for a non-GM caller, an unknown group, a missing `rooms` array, or a missing `map` when the overview doesn't exist yet. Problems with a single room don't throw. They go into the report, which is returned and also logged to the console:

| Field | Meaning |
|---|---|
| `overviewSceneId` | the overview scene |
| `created`, `updated` | room names whose Region was created or had its shape replaced |
| `linked` | `{ room, node }` pairs that were linked |
| `unmatchedRooms` | rooms that matched no node |
| `ambiguous` | `{ room, nodes }` where more than one node matched, so none was linked |
| `nodesWithoutRoom` | node labels that still have no Region |
| `rejected` | `{ room, reason }`: empty or duplicate name, malformed or non-finite points, fewer than three points |
| `warnings` | for example a point outside the map, or a map image that couldn't be loaded |

### `Flight.read({ groupId })`

Returns the setup in the same units `apply()` takes, so a script can check its own work:

```js
{
  group: "Lockwood Manor",
  overviewSceneId: "…",
  map: { src: "…", width: 2002, height: 3150 },
  rooms: [{ name: "Ballroom", regionId: "…", node: "Ballroom", points: [[120, 340], …] }],
  nodes: [{ id: "…", label: "Ballroom", room: "Ballroom" }]
}
```

`overviewSceneId` and `map` are `null`, and `rooms` is empty, when the group has no overview.

### `Flight.preview({ map, from, to, caption })`

Plays one flight on your own screen only. Nothing is saved and nothing is sent to other clients. Click the overlay to skip it.

```js
const { map, rooms } = ClickAdventure.Flight.read();
await ClickAdventure.Flight.preview({
  map,
  from: { kind: "map" },
  to: { kind: "room", points: rooms[0].points.flat() },
  caption: rooms[0].name
});
```

`map` is `{ src, width, height }`, with the size in map pixels. A framing is one of:

- `{ kind: "map" }` for the whole map fitted to the screen;
- `{ kind: "room", points: [x0, y0, x1, y1, …], label }` for a room, as a **flat** array;
- `{ kind: "view", x, y, scale }` for a centre and a zoom (start point only).

The travel time grows with the distance flown, from about 1.5 s between neighbouring rooms to about 3 s across the map. A flight to or from the whole map counts as a medium distance, and the time is multiplied by the group's pace: Slow, Normal or Fast in the Flight card. Every client flies at the GM's pace. `preview()` always flies at Normal. The fades and the hold are fixed.

### What actually flies

Only moves made by the GM in Guide mode fly, and only in a group whose flight switch is on: a double-click on a room on the overview, the HUD **Map** button, and Guide hops between linked rooms. Players moving on their own, Gated approvals, Manager teleports and group activation use the normal transition. A hop to a node without a Region also uses the normal transition. Player clients never read the overview's Regions. The GM sends them the geometry, and a flight message sent from a player's client is ignored. If the group has a travel sound, every client that flies plays it on its Interface volume, fading in with the flight and out on landing.

## Stored data

You can read this data from a macro or another module. Don't write to it: the shapes are internal, and Click Adventure keeps several of these values in step with each other.

| Where | Key | Contents |
|---|---|---|
| World setting | `click-adventure.graphs` | `{ activeGraphId, graphs: [{ id, name, startNodeId, nodes, links, flight?, source? }] }`. Each entry is a group. |
| User flag | `currentNodeId` | the node the user stands on |
| User flag | `previousNodeId` | the node they came from |
| User flag | `visitedSceneIds` | scenes the user has arrived at (used by Scene keys) |
| Scene flag | `isAdventureScene` | `true` on scenes created for nodes |
| Folder flag | `graphId` | the group a scene folder belongs to |
| Tile flag | `managed` | marks the background tile Click Adventure maintains |

All flags use the scope `click-adventure`:

```js
const nodeId = game.user.getFlag("click-adventure", "currentNodeId");
const { activeGraphId, graphs } = game.settings.get("click-adventure", "graphs");
const node = graphs.find(g => g.id === activeGraphId)?.nodes.find(n => n.id === nodeId);
```

A group's `flight` is `{ enabled, overviewSceneId, pace?, sound? }`, with `pace` one of `"slow"`, `"normal"`, `"fast"` (absent means Normal) and `sound` as `{ src, volume }` (absent means silence), and a node may carry `flightRegionId`. Both are optional: if they're absent, flight is off and the link is resolved by name.

A group imported or updated from a module carries `source`: `{ module, path, version, nodeIds, linkKeys }`, the module's id, the file's path, the module version applied last, and the node ids and links that version shipped. Update reads it to tell a node the module dropped from one the GM added.

The older `click-adventure.graph` setting is legacy and unused.

## Shipping an adventure in your module

Declare one or more export files in your `module.json`:

```json
"flags": {
  "click-adventure": {
    "adventures": ["modules/my-module/adventures/my-adventure.json"]
  }
}
```

Paths are full Data paths, like the image paths inside the file. When your module is active, **Export / Import** lists every group in those files with an **Import** button. Nothing is imported automatically. Foundry reads `module.json` only at launch, so restart the server after adding the flag.

The group keeps the `id` written in the file, which is how Click Adventure recognises it later. Once it is in the world, its row shows the version of your module it came from and offers **Update** and **Replace**. The **Update** button is highlighted when your module's `version` is newer, so bump it with each release.

**Update** shows the GM what changes and asks before applying it. The content comes from your file: labels, images, macros, linked scenes, journal pages, music and links. The world keeps the group's scenes and what the GM placed on them, Manager positions, play state (opened doors, fired macros, the image each room shows) and nodes the GM added. Nodes and links that your previous version had and this one dropped are removed, with their scenes. On the overview map, a changed map image is swapped, rooms are added or reshaped by name, rooms your file no longer names are left alone, and the GM's flight switch is kept. **Replace** starts the group over, after a confirmation, and loses every change made to it.

Keep the group's `id` stable across releases, or a new release shows up as a second adventure. Keep node `id`s stable too: a node whose id changes is removed and added again with a new scene.

## Export files

**Export / Import** in the module settings writes a JSON file with the selected groups. The import creates new scenes and a new group id, and finds macros, linked scenes, journal pages and playlist tracks in the destination world **by name**. If you generate adventures with a script, give those documents the same names in the target world, and they reconnect on import.

You can also write an import file by hand, or generate one with a script. Only `clickAdventureVersion`, the group's `name` and each node's `label` are required; this is the smallest file the import accepts:

```json
{
  "clickAdventureVersion": "1",
  "graphs": [{
    "id": "lockwood-manor",
    "name": "The Forgetting of Lockwood Manor",
    "start": "1. Gates",
    "nodes": [
      { "label": "1. Gates", "images": ["modules/my-module/scenes/01-gates.jpg"] },
      { "label": "3a. Entry", "images": ["modules/my-module/scenes/03a-entry.jpg"] }
    ],
    "links": [{ "from": "1. Gates", "to": "3a. Entry" }]
  }]
}
```

A node without an `id` gets a new one. A node without `x`/`y` is placed in the Manager where its room is on the overview map, when the file has a `flight` with rooms, and on a grid below the others when it has no room. An image can be just its path; its label defaults to the node's. `start` names the start node by label, and without it the first node starts. A link names its two nodes by exact label with `from` and `to`; a label that matches no node, or several, drops the link with a warning. Anchors are worked out from the nodes' positions. A navigation link without `passages` gets one passage, two-way unless `oneWay: true`, with an optional `label` and a `state` of `open`, `blocked` or `secret`. `type: "peek"` makes a peek link. Anything the export writes is accepted as it is. Give nodes an `id` if your module will be updated while players are in it. A node without one is matched to the world's node with the same label when it is the only one, and otherwise gets a new id, so players standing on it are moved off.

To ship a finished adventure as its own module, follow [Building a Distributable Adventure Module](https://github.com/brunocalado/click-adventure/wiki/Building-a-Distributable-Adventure-Module-for-Click-Adventure) in the Wiki.

## Contributing

Bug reports and pull requests are welcome at https://github.com/brunocalado/click-adventure. The code has no build step: clone the repo into your Foundry `Data/modules/click-adventure` folder and reload. A change to `module.json` (for example a new stylesheet) needs a server restart, because Foundry reads the manifest only at launch.
