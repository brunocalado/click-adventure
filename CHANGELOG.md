# Unreleased

- [Added] Flight over the overview map in Guide mode: double-click a room on the overview to take the party there, use Map in the HUD to bring them back out, and Guide moves between rooms fly over the map. A hop to a node without a Region uses the normal transition.
- [Added] Overview map for a group: `ClickAdventure.Flight.apply(data)` creates the group's overview scene from a map image and one GM-only Region per room from image-pixel polygons, linking each to the node of the same name; `ClickAdventure.Flight.read()` returns the current setup.
- [Added] `ClickAdventure.Flight.preview()` plays a camera flight over a map image between two framings, to check how an overview map looks.

# 0.3.1

## [Changed]
- **Installs and updates now come from GitHub releases.** The manifest URL is now `https://github.com/brunocalado/click-adventure/releases/latest/download/module.json`, and each version ships as a `module.zip` attached to its release instead of a zip of the `main` branch. Existing installs pick up the new URL on their next update.

# 0.3.0

## [Added]
- **Passage Direction and State are now two independent controls.** Which side(s) a passage exists on (Both ways / Forward / Backward) and what happens there (Open / Blocked / Secret / Custom) used to share one click-cycle. They are now separate: plain click on a single-passage link cycles direction, Ctrl/Cmd+click cycles state, and the Passage Editor grows a second button for the same reason. Every combination is reachable — previously a named passage could not be Blocked at all.
- **Custom passages — crossable only with a key.** Set a passage to Custom and drag an **Item** (the character must own it), an **Actor** (must be it), a **Macro** (must run and `return true`), or a **Scene** (must have been visited) onto its key panel, with an **AND / OR** toggle. Each player is evaluated on their own assigned character, and only at the moment they click the destination — so a key macro's side effects fire on a real attempt and never once per HUD render. The GM always bypasses the check, and an empty key list behaves like Open. A second toggle chooses whether players see the passage with a key icon before it unlocks, or nothing at all.
- **Per-player visited-scene tracking**, recorded on every arrival — the data behind the Scene key. Every path that moves a player now goes through one shared function, so it stays accurate however they got there.
- **Reset Visited Scenes.** The Manager toolbar's Reset button is now a dropdown; the new entry clears every player's visited-scene history so a playthrough can start fresh.
- **Journal Auto-Open switch** (Settings → HUD). Turns off the automatic journal pop-up globally without touching any node's own trigger. On by default.
- **Dead-end warning.** A node whose every exit is Blocked or Secret gets a red outline and a tooltip in the Manager. GM-only signal; nothing is blocked or auto-fixed.

## [Changed]
- **The two non-Open states are renamed to match what they do.** What was *Locked* (visible to players, not traversable) is now **Blocked**, keeping its red ⊘. What was *Blocked* (hidden from players) is now **Secret**, with a mask icon — "blocked" reads more naturally as the visible-but-shut state than the hidden one. **Existing worlds are unaffected:** old data is read through a mapping that preserves what each link already did, so a passage that was Locked stays visible-and-shut and one that was Blocked stays hidden. No migration, no prompt, nothing rewritten — a link simply converts to the new format the first time you touch it.
- **Multi-passage links show every passage's state at a glance.** Instead of one thick line, a multi-passage link now draws one thin dotted line per passage, stacked side by side, each coloured by its own state.
- **A one-way passage no longer has a phantom open side.** The non-designated side of a Forward/Backward passage now has no route at all, instead of being silently treated as Open.
- **Secret and Custom glyphs on the canvas take their state colour.** They were emoji (🎭/🔑), and a colour emoji ignores SVG `fill`, so both always rendered in their fixed default colour. They are real Font Awesome mask/key glyphs now.
- **Linked scenes remember the last one picked.** Choosing a linked scene — from the HUD switcher or Node Configuration — now persists on the node, the same way choosing an image already did. Navigating away and back keeps showing it.
- The Links tab of the Instructions window was rewritten for the two-axis model and the key conditions.

## [Fixed]
- **Guide Mode's "Activate (global)" was ignored when switching a node's linked scenes.** It applied to node-to-node navigation only, so cycling a node's linked scenes always fell back to per-client viewing — and a scene-bound playlist therefore never started. Linked-scene switching now honours the same setting.
- **Rapid clicks on the image / linked-scene switcher could race.** Clicking again before the previous switch's `scene.view()`/socket chain settled could land the two out of order on a player's client, leaving a stale canvas until they navigated away and back. A click during a switch is now ignored.
- **Blocked destinations in the player HUD no longer also show a padlock.** The "the GM is holding this player" flag was being set for merely-Blocked destinations too, stacking a lock icon on top of the ban icon they already carry. The two are unrelated.
- **A Blocked passage is hidden from players when another passage on the same link already gets them there** — it was only ever a disabled duplicate of a door that leads nowhere useful from that side. GMs still see every passage.
- **A key macro the player cannot execute now says so.** Foundry declines the run without throwing, which read as "key not satisfied" and left no trace; the console now names the macro and points at its Ownership.

# 0.2.2

## [Changed]
- **HUD destination buttons put the passage name on its own line.** A destination reached through a named passage was labelled `Node name (Passage name)` on a single line, and the HUD panel is only 200px wide, so the passage name — the part that distinguishes two buttons leading to the same room — was almost always the half that got cut off. The node name now sits on the first line and the passage name in italic underneath it. Long text wraps instead of truncating, including text with no spaces to break on, and the button grows to fit however many lines it needs. Passages shown in *Path Name only* mode are unchanged: the passage name is still the single label, with no second line.
- **The two node badges in the Link Editor header are 14px**, up from 12px, matching the arrow between them.

# 0.2.1

## [Changed]
- **The whole interface was redesigned.** Every window in the module now shares one visual system: true-dark neutral surfaces, an amber accent for confirming actions, blue for additive ones, and green for on/default states. Labels sit on the same line as the control they name instead of stacked above it, list entries are cards rather than flat rows, and each window's one global action (Add Media, and the like) rides the tab row instead of claiming a line of its own. All nine windows were previously styled independently, which is why they never quite looked like the same product.
- **Windows open wider.** The new density needs more room: Node Configuration went from 660 to 820px, Settings, Link Editor, Export/Import and Adventure Groups from 420-480 to 560, Instructions from 480x560 to 700x640 (it also gained two tabs), and HUD Button Style from 340 to 460. At the old widths, buttons in a card row overflowed and the destructive action ended up flush against the one the user actually wants.
- **Confirmation dialogs are themed.** Delete Node, Delete Link, Delete Group, Reset Group, Reset Macros, New Group and Rename Group used to appear in Foundry's default chrome, visibly foreign to the rest of the module. They now carry the module's frame, and the destructive choice is a red button rather than a generic one.
- **Toolbar state toggles read as switches.** *Free Move: OFF* was red, which looked like an error rather than a deliberate setting; it is now neutral grey, with green reserved for the ON state. *Autolock: ON* is green for the same reason.
- **The HUD button's default colour is now amber** (`#d4a017`) instead of blue, to match the rest of the interface. Worlds where the GM already picked a colour are unaffected; worlds that never changed it will see the new default.
- Module windows now force a dark colour scheme regardless of Foundry's own light/dark theme setting, since the palette is built around amber on black.
- **Two features finally documented in the built-in Instructions.** The help window never mentioned **Adventure Groups** or **Export / Import**, even though both ship in the UI. New *Groups* and *Export / Import* tabs cover what a group is, what Activate actually does to online players (and why it appears to do nothing when the start node has no scene), when Delete is refused, where the export screen lives in Foundry's own settings, and how macro / journal / playlist / linked-scene references are resolved on import.
- **The built-in Instructions were brought back in line with the interface.** They still described the old *+ Add Media* button and the *Navigation Name* field, and listed the passage-editor footer in an order it no longer uses. The colour swatches in the Links and Camera Room tabs now read their colours from the same tokens the canvas paints with, so a retuned state colour can no longer leave the help text describing the old one.

## [Fixed]
- **HUD destination buttons had no contrast against their own panel.** Buttons inside the destinations list, the media switcher and the camera panel drew on the same surface colour as the panel behind them, leaving only a 1px border to separate them.
- **The macro column in Node Configuration overflowed its card.** Run / Open / Remove needed more width than the 200px column allows, so the buttons spilled past the card edge instead of wrapping.

## [Internal]
- New `styles/_components.css` holds the shared UI primitives — buttons, inputs, labels, tabs, cards, dropzones, switches and segmented groups — that every window now draws from. Each window's own stylesheet keeps only what is genuinely unique to it, which removed roughly 900 lines of duplicated CSS.
- Every colour literal in the module now lives in `styles/_tokens.css`; the 62 hex values and ~260 `rgba()` calls previously scattered across the other stylesheets are gone. Tokens are split into two deliberate tiers: muted `--ca-accent-*` / `--ca-fn-*` for window chrome, and vivid `--ca-state-*` for the node graph, where a 2px SVG stroke needs a colour that survives being one pixel wide.
- Templates kept every class the apps bind listeners to, so the redesign touched no event wiring. The three tabbed windows now share a single `ca-tab--active` state class instead of three differently-named ones.
- `styles/_foundry-overrides.css` documents two v14 behaviours worth knowing: Foundry declares all of its CSS inside `@layer`, so unlayered module rules win without `!important`; and it declares `--button-*` / `--input-*` on the elements themselves, so retheming has to target the elements rather than an ancestor.

# 0.2.0

## [Added]
- **Journal tab in node configuration.** Drag a journal page (or a whole entry) onto a node to assign it, with a trigger controlling when it opens: **On Scene View**, **On Scene Activate**, or **On View or Activate**. It is a shortcut for the Scene's own journal field — the value shows up in the scene's native configuration too, and the module only adds the automatic opening. Visibility follows the page's own Foundry permissions: a player who can observe the page sees it open on arrival, a player who cannot sees nothing at all, with no error. On activation the opening is broadcast, so every client evaluates its own permission.
- **Music tab in node configuration.** Drag a playlist track (or a whole playlist) onto a node to set the Scene's playlist field. Playback is Foundry's own: the track starts when the scene is **activated**, not when it is merely viewed from the HUD. Dropping a whole playlist leaves the track unset, so Foundry follows the playlist's own playback mode.
- Both tabs accept compendium documents, importing them into the world first — a Scene's journal and playlist fields hold world IDs, so a pack document could never be referenced directly. A node that has no Foundry scene yet keeps the choice staged and writes it into the scene the moment **Create / Update Scenes** runs.
- **Player View trigger for node macros.** The Macros tab now offers the same four triggers as the Images and Linked Scenes tabs — *GM Activate*, *Player View*, *GM View*, and *GM View or Activate* — so the GM decides per macro who runs it. The Always/Once execution mode remains exclusive to node macros. Note that a macro triggered on a player's client still needs Foundry's own permissions: the player must own the macro, and the world's **Configure Permissions** must allow their role to use script macros.

## [Changed]
- **Export and import now carry a node's journal, music, and camera room settings.** Every cross-document reference is written with its name alongside its ID, the same way macro references already were, so an import resolves by ID in the source world and falls back to name in any other. A journal found without its page keeps the entry (the whole entry opens instead); a playlist found without its track keeps the playlist — both with a warning. Only a missing root document clears the reference. `isCameraRoom` and `cameraLabel` were also silently dropped on export before this version and now travel with the node.

## [Fixed]
- **Node macros never fired when navigating with the HUD.** Macros attached in the node's **Macros** tab only ran when the GM used *View Scene* or *Activate Scene* in the Manager — navigating through the HUD, which is how the game is actually played, fired the per-image and per-linked-scene macros but silently skipped every node macro. This made the Macros tab look broken: the ▶ Run button worked, navigation did not. HUD navigation now fires exactly the same set of macros the Manager fires, and so do arrivals that reach a player through a socket (GM teleport, and approval in Gated mode).
- **Macros set to "GM View or Activate" fired twice.** The HUD dispatched the trigger and then dispatched `gm-any` again, while the trigger matching already treated `gm-any` as covering both cases — so every such macro ran two times per arrival.
- **Macros marked GM-only ran on players' clients.** The `gm-any` wildcard matched *any* trigger, including `player-view`, so a macro the GM had explicitly marked "GM View or Activate → GM only" executed on a player's client when they navigated. It now covers *GM View* and *GM Activate* only.

# 0.1.9

## [Changed]
- **Start Node no longer auto-places players.** Previously, a player with no saved position was silently teleported to the graph's Start Node on world load, and again as a fallback whenever the HUD rendered — and marking a new node as Start would immediately reset the position of *every* user, even players already mid-adventure, the moment the GM hit Save. A player with no saved position is now left untouched instead — Foundry simply shows whatever scene is otherwise active, and the GM places them manually via the node right-click teleport menu. The Start Node toggle itself is unchanged and still marks which node **Activate Group** sends everyone to.

## [Fixed]
- **Navigation HUD no longer reappears after switching to a non-adventure scene.** Activating a scene outside the Click Adventure graph correctly closed the HUD, but a stale re-render triggered by the HUD's own canvas-reload handler could reopen it again before the close finished, leaving it visible on scenes it shouldn't appear on. The HUD now re-checks scene membership itself before deciding to re-render.

# 0.1.8

## [Fixed]
- https://github.com/brunocalado/click-adventure/issues/7
- **World load no longer overrides a GM-activated scene outside the adventure.** Previously, on every world load, the module would silently switch a user's view — GM included — to the adventure's start scene whenever the currently active scene differed from that user's saved position, even if the GM had deliberately activated a scene that isn't part of the adventure at all. The automatic position-restore on load now only kicks in when the currently viewed scene already belongs to the adventure graph; a scene the GM chose on purpose that isn't part of the module is never touched.

# 0.1.7

## [Added]
- **Load Player Tokens toggle:** a new switch in Manager → gear icon → **Tokens** tab controls whether a player's linked-actor token is automatically created/moved into a node's scene as they navigate. When **off**, navigation only changes the view and no tokens are placed (tokens already in a scene are left in place). The setting is **per group** — each adventure group keeps its own value — and defaults to **on**, so existing behavior is unchanged. Turning on *Saved Positions* or clicking *Capture Positions* automatically switches Load Player Tokens on, since both rely on tokens being loaded.

# 0.1.6

## [Changed]
- **Settings window redesign:** the Manager → gear icon settings panel is now organized into four tabs — **Scenes**, **HUD**, **Tokens**, and **Danger** — instead of one long scroll. Each setting sits in its own card with its explanatory text grouped inside it, so it's always clear which description belongs to which control. Text contrast and sizing were increased for readability.
- **Toggle switches:** the *Show Player Locations*, *Player Destination Preview*, and *Saved Positions* on/off controls are now sliding switches (green when on) instead of the old "Enabled/Disabled" buttons. Behavior and saved values are unchanged.

# 0.1.5

## [Added]
- **Player Destination Preview toggle:** a new GM-controlled switch (Manager → gear icon → HUD Visibility) controls whether players can use the eye icon on destination buttons to preview a room's image before entering it. **It is OFF by default**, so players no longer see destination previews unless the GM turns it on. The GM always sees the previews regardless of the setting. Other-player location previews are unaffected (they remain governed by *Show Player Locations*).

> Behavior change: in worlds upgrading from a previous version, players lose the destination preview eye until the GM enables this setting.

# 0.1.4

## [Fixed]
- **New nodes now appear in the visible area at any zoom level.** Pressing **+** while zoomed in past 100% could place the new node outside the visible workspace, forcing you to pan around to find it. Node creation now accounts for the current zoom factor (matching the screen-to-canvas conversion the rest of the workspace already used), so a new node always lands at the center of the visible view. Behavior at 100% zoom is unchanged.

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
