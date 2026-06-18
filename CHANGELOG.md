# 0.1.3

## [Fixed]
- **Creating scenes no longer deletes other groups' scenes.** Previously all groups shared a single "Click Adventure" scene folder, so pressing **Create / Update Scenes** while a second group was active deleted the first group's scenes — destroying any GM customizations (placed tiles, tokens, walls, lighting, assets). Each group now owns its own scene folder, so the cleanup that runs on Create / Update Scenes is scoped to the active group and can never touch another group's scenes.

## [Changed]
- **Per-group scene folders:** each adventure group keeps its Foundry scenes in its own dedicated folder (named *Click Adventure — &lt;group name&gt;*). Renaming a group renames its folder; if the folder is deleted manually it is recreated on the next Create / Update Scenes.
- **Group deletion cleanup:** deleting a group now also removes that group's scene folder and its scenes, so nothing is left orphaned.
- **Reset is now per-group:** the Danger Zone button is now **Reset Group** and clears only the current group's nodes, links, and scenes. Other groups are untouched.
- **Import:** each imported adventure now creates its scenes in its own folder instead of a shared one.

> No migration is performed: scenes created before this version stay in the existing shared folder. Only scenes created from now on are placed in per-group folders.

# 0.1.2

## [Added]
- **Camera Room — Restore View button:** the peek panel in the player HUD now includes a **Restore View** button at the top. Clicking it cancels any active peek and returns the background tile to the player's own room without navigating.
- **Camera Room — custom button label:** a **Button Label** text field now appears in the node Settings tab when Camera is ON. The text entered here is used as the label on the HUD button and peek panel header for that room (defaults to *Cameras* when left blank). Allows renaming the feature per-node (e.g. *Monitors*, *Scrying Pool*).

## [Changed]
- Instructions window: camera room documentation moved from the Links tab into a dedicated **Camera Room** tab covering setup, peek link creation, HUD behavior, the Restore View button, and the custom label option.

# 0.1.1

## [Added]
- **Peek / Camera Room feature:** GMs can toggle any node as a "Camera Room" via the **Camera: ON/OFF** toggle in the node's Settings tab (double-click a node → Settings). When a node is marked as a camera room, small teal corner anchors appear on all nodes; drag corner-to-corner to draw **peek links** (teal dashed lines with 👁 indicator) — corner anchors can only connect to other corner anchors. Players inside a camera room gain a **Cameras** button in the HUD; clicking it opens a panel listing all rooms reachable via peek links. Clicking a room swaps the current scene's background tile texture to show the peeked room's image (PIXI-level, per-client — other players are unaffected). Peek is reset on navigation or scene reload.

# 0.1.0

## [Added]
- **Visual Polls integration:** when the `visual-polls` module is active, a **Poll** button appears in the Manager toolbar. Clicking it launches a `VisualPolls.startPoll()` targeted at all online non-GM players, listing the navigable destinations from the GM's current node as voting options. Destinations with images use them as poll thumbnails. Links that are `blocked` or `locked` are excluded from the options.

# 0.0.9

## [Added]
- Players now see all other connected non-GM players listed in their navigation HUD, regardless of which scene each player is in. Hovering the eye icon next to a player's name shows a tooltip preview of the node image for where that player currently is.
- New world setting **Show Player Locations** (`showPlayerWhisper`) — toggle the player list feature on or off.



# 0.0.7

## [Added]
- Preview eye icons next to destination names in the navigation HUD. Hover to see a tooltip with the destination's current image or video, helping GMs navigate without opening the manager.
- Preview eye icons in the Media switcher panel (Images and Linked Scenes lists) with the same hover tooltip behavior.
- Alert indicator on the "Create Scenes" / "Update Scenes" button showing the count of nodes missing Foundry scenes. The button highlights in amber when there are unmapped nodes, displaying (X) to indicate how many scenes need to be created or updated.

## [Changed]
- Replaced inline SVG icons in the manager (settings gear, view-scene eye, activate-scene play, and start-node star) with FontAwesome equivalents for cleaner markup.
- Folder import now automatically zooms and pans to fit all imported nodes within the visible view, eliminating the need to manually press "Zoom All" after importing.
- New adventure groups now default to "New Group 1", "New Group 2", etc., with automatic number incrementing to avoid duplicates.
- Pressing "Activate" on an adventure group now also opens the Scene Graph manager window.

## [Fixed]
- Videos now display animated in the manager workspace (previously only showed as a static placeholder; they already worked in the node config tooltip).



# 0.0.6

## [Added]
- Rubber-band selection (drag a rectangle on the canvas background to select multiple nodes at once); Shift+drag adds to the existing selection instead of replacing it.
- Zoom All button (next to the 100% button) — fits all nodes into the current view at the largest zoom level that keeps the entire graph visible; helpful when the canvas is panned away from all nodes.

## [Changed]
- Zoom reset button label changed from "1:1" to "100%".

# 0.0.5

## [Changed]
- Rewrote the in-app Instructions window to match current behaviour: split into Toolbar, Canvas, Nodes, Links, and Players tabs; corrected the node right-click action (online-player teleport menu, not set-start/delete), the Create/Update Scenes button, the Linked Scenes tab, start-node and delete via node config, and player-row click (centers the canvas, not teleport).
