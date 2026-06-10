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
