/**
 * GroupManagerApp
 *
 * GM-only window for creating, deleting, and activating named adventure graph groups.
 * Exposed on the global API as `ClickAdventure.Groups()`.
 *
 * Activating a group:
 *   1. Guard: the group's startNode must have a sceneId.
 *   2. Persist new activeGraphId.
 *   3. Clear Manager pan/zoom.
 *   4. Move all online players to the new startNode.
 *   5. Broadcast ACTIVATE_GRAPH so every client re-renders their HUD and Manager.
 */

import { MODULE_ID } from "./constants.js";

export class GroupManagerApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: "group-manager-app",
    classes: [MODULE_ID, "group-manager"],
    window: {
      title: "Adventure Groups",
      frame: true,
      positioned: true
    },
    position: { width: 480, height: "auto" },
    actions: {
      activateGroup: GroupManagerApp.prototype._onActivateGroup,
      renameGroup:   GroupManagerApp.prototype._onRenameGroup,
      deleteGroup:   GroupManagerApp.prototype._onDeleteGroup,
      newGroup:      GroupManagerApp.prototype._onNewGroup
    }
  };

  static BASE_APPLICATION = foundry.applications.api.ApplicationV2;

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/group-manager-app.hbs` }
  };

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Builds the context for the group list template.
   * @override
   * @returns {Promise<object>}
   */
  async _prepareContext(_options) {
    const col = game.settings.get(MODULE_ID, "graphs");
    const raw = typeof col?.toObject === "function" ? col.toObject() : (col ?? {});
    const graphs        = raw.graphs        ?? [];
    const activeGraphId = raw.activeGraphId ?? "";

    return {
      isGM: game.user.isGM,
      groups: graphs.map(g => ({
        ...g,
        isActive:  g.id === activeGraphId,
        // Delete is disabled for the active group and when it is the only group.
        canDelete: graphs.length > 1 && g.id !== activeGraphId
      }))
    };
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Activates the selected group. Moves all online players to its startNode.
   * Called via data-action="activateGroup" data-group-id="<id>".
   *
   * @param {PointerEvent} _event
   * @param {HTMLElement}  target
   * @returns {Promise<void>}
   */
  async _onActivateGroup(_event, target) {
    if (!game.user.isGM) return;
    const groupId = target.dataset.groupId;
    if (!groupId) return;

    const col = game.settings.get(MODULE_ID, "graphs");
    const raw = typeof col?.toObject === "function" ? col.toObject() : (col ?? {});
    const group = (raw.graphs ?? []).find(g => g.id === groupId);
    if (!group) return;

    // Persist new active graph and reset Manager pan.
    await game.settings.set(MODULE_ID, "graphs", { ...raw, activeGraphId: groupId });
    await game.settings.set(MODULE_ID, "managerPan", { x: 0, y: 0 });

    // Only teleport players when the start node has an associated scene.
    // An empty or scene-less group is still activatable — players simply stay put.
    const startNode = (group.nodes ?? []).find(n => n.id === group.startNodeId);
    if (startNode?.sceneId) {
      const players = game.users.filter(u => !u.isGM && u.active);
      for (const user of players) {
        await user.unsetFlag(MODULE_ID, "previousNodeId");
        await user.setFlag(MODULE_ID, "currentNodeId", startNode.id);
        globalThis.ClickAdventure._socket.teleportUser(startNode.sceneId, user.id, startNode.id);
      }
    }

    // The emitting client never receives its own socket broadcast (socket.io rule).
    // Handle the activate event locally for the GM before broadcasting to others.
    globalThis.ClickAdventure._socket._handleActivateGraph({ graphId: groupId });
    globalThis.ClickAdventure._socket.activateGraph(groupId);

    this.render({ force: true });
    globalThis.ClickAdventure.Manager();
  }

  /**
   * Deletes a group after GM confirmation.
   * Disabled (via template) for the active group and when only one group exists.
   *
   * @param {PointerEvent} _event
   * @param {HTMLElement}  target
   * @returns {Promise<void>}
   */
  async _onDeleteGroup(_event, target) {
    if (!game.user.isGM) return;
    const groupId = target.dataset.groupId;
    if (!groupId) return;

    const col = game.settings.get(MODULE_ID, "graphs");
    const raw = typeof col?.toObject === "function" ? col.toObject() : (col ?? {});
    const graphs = raw.graphs ?? [];

    // Double-check guards (buttons should already be disabled in template).
    if (graphs.length <= 1 || groupId === raw.activeGraphId) return;

    const group = graphs.find(g => g.id === groupId);
    const label = group?.name ?? groupId;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Delete Group" },
      content: `<p>Delete group <strong>${label}</strong>? This cannot be undone.</p>`,
      yes: { label: "Delete", icon: "fas fa-trash" },
      no:  { label: "Cancel" }
    });
    if (!confirmed) return;

    await game.settings.set(MODULE_ID, "graphs", {
      ...raw,
      graphs: graphs.filter(g => g.id !== groupId)
    });

    this.render({ force: true });
  }

  /**
   * Opens a prompt dialog pre-filled with the next available "New Group N" name
   * and creates a new empty group. Called via data-action="newGroup".
   *
   * @param {PointerEvent} _event
   * @param {HTMLElement}  _target
   * @returns {Promise<void>}
   */
  async _onNewGroup(_event, _target) {
    if (!game.user.isGM) return;

    const col = game.settings.get(MODULE_ID, "graphs");
    const raw = typeof col?.toObject === "function" ? col.toObject() : (col ?? {});

    // Find the lowest unused "New Group N" number.
    const usedNums = new Set(
      (raw.graphs ?? [])
        .map(g => { const m = /^New Group (\d+)$/.exec(g.name); return m ? +m[1] : null; })
        .filter(n => n !== null)
    );
    let n = 1;
    while (usedNums.has(n)) n++;
    const defaultName = `New Group ${n}`;

    let name;
    try {
      name = await foundry.applications.api.DialogV2.prompt({
        window: { title: "New Group" },
        content: `
          <div class="form-group">
            <label>Group Name</label>
            <div class="form-fields">
              <input type="text" name="groupName" maxlength="120"
                     value="${foundry.utils.escapeHTML(defaultName)}" autofocus />
            </div>
          </div>`,
        ok: {
          label: "Create",
          icon: "fas fa-plus",
          callback: (_ev, btn) => btn.form.elements.groupName.value.trim() || defaultName
        }
      });
    } catch (_e) {
      // Dialog closed without confirming.
      return;
    }
    if (!name) return;

    const newGroup = {
      id:          foundry.utils.randomID(),
      name,
      startNodeId: "",
      nodes:       [],
      links:       []
    };

    await game.settings.set(MODULE_ID, "graphs", {
      ...raw,
      graphs: [...(raw.graphs ?? []), newGroup]
    });

    this.render({ force: true });
  }

  /**
   * Opens a prompt dialog to rename an existing group. Name is capped at 120 characters.
   * Called via data-action="renameGroup" data-group-id="<id>".
   *
   * @param {PointerEvent} _event
   * @param {HTMLElement}  target
   * @returns {Promise<void>}
   */
  async _onRenameGroup(_event, target) {
    if (!game.user.isGM) return;
    const groupId = target.dataset.groupId;
    if (!groupId) return;

    const col = game.settings.get(MODULE_ID, "graphs");
    const raw = typeof col?.toObject === "function" ? col.toObject() : (col ?? {});
    const graphs = raw.graphs ?? [];
    const group = graphs.find(g => g.id === groupId);
    if (!group) return;

    let name;
    try {
      name = await foundry.applications.api.DialogV2.prompt({
        window: { title: "Rename Group" },
        content: `
          <div class="form-group">
            <label>Group Name</label>
            <div class="form-fields">
              <input type="text" name="groupName" maxlength="120"
                     value="${foundry.utils.escapeHTML(group.name)}" autofocus />
            </div>
          </div>`,
        ok: {
          label: "Rename",
          icon: "fas fa-pencil",
          callback: (_ev, btn) => btn.form.elements.groupName.value.trim() || null
        }
      });
    } catch (_e) {
      return;
    }
    if (!name || name === group.name) return;

    await game.settings.set(MODULE_ID, "graphs", {
      ...raw,
      graphs: graphs.map(g => g.id === groupId ? { ...g, name } : g)
    });

    this.render({ force: true });
  }

}
