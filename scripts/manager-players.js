/**
 * Player occupancy, teleportation, context menu, and navigation request handlers.
 * Extracted from ManagerApp to keep the main shell small.
 *
 * Every function receives the ManagerApp instance as `app` so it can
 * access `app.element`, `app._navRequests`, and trigger renders.
 */

import { getGraphData } from "./node-utils.js";

// ---------------------------------------------------------------------------
// Occupant map
// ---------------------------------------------------------------------------

/**
 * Builds a map of nodeId → occupant display data for all active non-GM users.
 * name priority: linked actor name → user name.
 * @returns {Map<string, Array<{name: string, color: string}>>}
 */
export function buildOccupants() {
  const map = new Map();
  for (const user of game.users) {
    if (user.isGM || !user.active) continue;
    const nodeId = user.getFlag("click-adventure", "currentNodeId");
    if (!nodeId) continue;

    const name  = user.character?.name ?? user.name;
    const color = user.color?.css ?? user.color ?? "#ffffff";

    if (!map.has(nodeId)) map.set(nodeId, []);
    map.get(nodeId).push({ name, color });
  }
  return map;
}

/**
 * Builds the data array used to render the player panel sidebar.
 * Includes all non-GM users (active and inactive).
 * @returns {Array<{ userId, displayName, color, active, nodeId, nodeLabel }>}
 */
export function buildPlayerPanelData() {
  const { nodes } = getGraphData();
  return game.users
    .filter(u => !u.isGM)
    .map(u => {
      const nodeId    = u.getFlag("click-adventure", "currentNodeId") ?? null;
      const node      = nodes.find(n => n.id === nodeId);
      return {
        userId:      u.id,
        displayName: u.character?.name ?? u.name,
        color:       u.color?.css ?? u.color ?? "#ffffff",
        active:      u.active,
        nodeId:      nodeId,
        nodeLabel:   node?.label ?? null
      };
    });
}

// ---------------------------------------------------------------------------
// Occupant DOM patching
// ---------------------------------------------------------------------------

/**
 * Updates occupant name label strips in-place without triggering a full re-render.
 * Called when a PLAYER_MOVED socket message is received while the manager is open.
 * Safe to call at any time — no-op if the manager is not rendered.
 * @param {ManagerApp} app
 */
export function patchOccupantAvatars(app) {
  if (!app.rendered) return;
  const html = app.element;

  const occupants   = buildOccupants();       // nodeId → [{name, color}]
  const panelData   = buildPlayerPanelData(); // array of player rows

  // ── 1. Update node badges (count + icon, no text labels) ──────────────────
  html.querySelectorAll(".ca-node").forEach(nodeEl => {
    const nodeId = nodeEl.dataset.nodeId;
    const count  = (occupants.get(nodeId) ?? []).length;

    // Remove old occupant labels strip
    nodeEl.querySelector(".ca-node-occupants")?.remove();

    // Update or remove the count badge
    let badge = nodeEl.querySelector(".ca-node-occupant-badge");
    if (count === 0) {
      badge?.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "ca-node-occupant-badge";
      nodeEl.appendChild(badge);
    }
    badge.innerHTML = `<i class="fa-solid fa-people-group"></i><span>${count}</span>`;
  });

  // ── 2. Rebuild player panel rows ──────────────────────────────────────────
  const list = html.querySelector(".ca-player-list");
  if (!list) return;
  list.innerHTML = "";

  for (const p of panelData) {
    const li = document.createElement("li");
    li.className = "ca-player-row" + (p.active ? "" : " ca-player-row--offline");
    li.dataset.userId = p.userId;
    if (p.nodeId) li.dataset.nodeId = p.nodeId;

    li.innerHTML = `
      <span class="ca-player-dot" style="background:${p.color};"
            title="${p.active ? "Online" : "Offline"}"></span>
      <span class="ca-player-name">${p.displayName}</span>
      ${p.nodeLabel
        ? `<span class="ca-player-location" title="${p.nodeLabel}">${p.nodeLabel}</span>`
        : `<span class="ca-player-location ca-player-location--none">—</span>`
      }
    `;

    // Click: center canvas on the player's node
    if (p.nodeId) {
      li.addEventListener("click", () => _focusNode(app, p.nodeId));
    }

    // Hover: highlight the corresponding node
    li.addEventListener("mouseenter", () => _setNodeHighlight(app, p.nodeId, true));
    li.addEventListener("mouseleave", () => _setNodeHighlight(app, p.nodeId, false));

    list.appendChild(li);
  }
}

// ---------------------------------------------------------------------------
// Private helpers — panel interaction
// ---------------------------------------------------------------------------

/**
 * Centers the canvas viewport on the given node by adjusting app._pan.
 * @param {ManagerApp} app
 * @param {string} nodeId
 */
function _focusNode(app, nodeId) {
  if (!nodeId) return;
  const nodeEl = app.element?.querySelector(`.ca-node[data-node-id="${nodeId}"]`);
  if (!nodeEl) return;

  const workspace = app.element.querySelector(".ca-workspace");
  if (!workspace) return;

  const nodeX = parseFloat(nodeEl.style.left) || 0;
  const nodeY = parseFloat(nodeEl.style.top)  || 0;

  const wRect  = workspace.getBoundingClientRect();
  const centerX = wRect.width  / 2;
  const centerY = wRect.height / 2;

  app._pan = {
    x: centerX - nodeX - (nodeEl.offsetWidth  / 2),
    y: centerY - nodeY - (nodeEl.offsetHeight / 2)
  };

  const canvas = app.element.querySelector(".ca-canvas");
  if (canvas) canvas.style.transform = `translate(${app._pan.x}px, ${app._pan.y}px)`;

  // Briefly highlight the node after centering
  _setNodeHighlight(app, nodeId, true);
  setTimeout(() => _setNodeHighlight(app, nodeId, false), 1200);
}

/**
 * Adds or removes the highlight class on a specific node element.
 * @param {ManagerApp} app
 * @param {string|null} nodeId
 * @param {boolean} on
 */
function _setNodeHighlight(app, nodeId, on) {
  if (!nodeId) return;
  const nodeEl = app.element?.querySelector(`.ca-node[data-node-id="${nodeId}"]`);
  nodeEl?.classList.toggle("ca-node--highlighted", on);
}

// ---------------------------------------------------------------------------
// Navigation requests
// ---------------------------------------------------------------------------

/**
 * Approves a pending navigation request: updates the player's flag and emits approval.
 * Triggered by clicking the approve button in the requests drawer.
 * @param {ManagerApp} app
 * @param {string} userId
 * @param {string} toNodeId
 * @returns {Promise<void>}
 */
export async function approveRequest(app, userId, toNodeId) {
  const request = app._navRequests.get(userId);
  if (!request) return;

  app._navRequests.delete(userId);

  const user = game.users.get(userId);
  if (user) {
    // Preserve the "came from" context on approval
    if (request.fromNodeId) {
      await user.setFlag("click-adventure", "previousNodeId", request.fromNodeId);
    } else {
      await user.unsetFlag("click-adventure", "previousNodeId");
    }
    await user.setFlag("click-adventure", "currentNodeId", toNodeId);
  }

  const { nodes } = getGraphData();
  const targetNode = nodes.find(n => n.id === toNodeId);

  globalThis.ClickAdventure._socket.approveNavRequest(userId, toNodeId, targetNode?.sceneId ?? null);
  patchOccupantAvatars(app);
  patchRequestsDrawer(app);
}

/**
 * Approves all pending navigation requests in one action.
 * Iterates a snapshot of the queue so deletions inside approveRequest
 * don't mutate the collection mid-loop.
 * @param {ManagerApp} app
 * @returns {Promise<void>}
 */
export async function onApproveAll(app) {
  const pending = [...app._navRequests.values()];
  for (const request of pending) {
    await approveRequest(app, request.userId, request.toNodeId);
  }
}

/**
 * Rejects a pending navigation request and notifies the player.
 * Triggered by clicking the reject button in the requests drawer.
 * @param {ManagerApp} app
 * @param {string} userId
 */
export function rejectRequest(app, userId) {
  app._navRequests.delete(userId);
  globalThis.ClickAdventure._socket.rejectNavRequest(userId);
  patchRequestsDrawer(app);
}

/**
 * Patches the requests button badge and drawer content in-place after any queue mutation.
 * Avoids a full re-render — mirrors the pattern used by patchOccupantAvatars.
 * Safe to call at any time — no-op if the manager is not rendered.
 * @param {ManagerApp} app
 */
export function patchRequestsDrawer(app) {
  if (!app.rendered) return;
  const html = app.element;
  const count = app._navRequests.size;

  const btn = html.querySelector(".ca-requests-btn");
  if (btn) {
    btn.textContent = count > 0 ? `Requests (${count})` : "Requests";
    btn.classList.toggle("ca-requests-btn--active", count > 0);
  }

  const drawer = html.querySelector(".ca-requests-drawer");
  if (!drawer) return;

  // Sync the approve-all button: create on first request, update count, remove when empty.
  let approveAllBtn = drawer.querySelector(".ca-approve-all-btn");
  if (count === 0) {
    approveAllBtn?.remove();
  } else if (!approveAllBtn) {
    approveAllBtn = document.createElement("button");
    approveAllBtn.className = "ca-approve-all-btn";
    approveAllBtn.type = "button";
    approveAllBtn.textContent = `Approve All (${count})`;
    approveAllBtn.addEventListener("click", () => onApproveAll(app));
    const header = drawer.querySelector(".ca-requests-drawer-header");
    header.insertAdjacentElement("afterend", approveAllBtn);
  } else {
    approveAllBtn.textContent = `Approve All (${count})`;
  }

  const { nodes } = getGraphData();
  const getLabel = id => nodes.find(n => n.id === id)?.label || id;
  const requests = [...app._navRequests.values()].sort((a, b) => a.timestamp - b.timestamp);

  const existing = drawer.querySelector(".ca-requests-list, .ca-requests-empty");
  if (!existing) return;

  if (requests.length === 0) {
    existing.outerHTML = `<div class="ca-requests-empty">No pending requests.</div>`;
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "ca-requests-list";

  for (const r of requests) {
    const li = document.createElement("li");
    li.className = "ca-request-item";
    li.dataset.userId = r.userId;
    li.innerHTML = `
      <span class="ca-request-dot" style="background:${r.userColor};"></span>
      <span class="ca-request-info">
        <strong>${r.userName}</strong>
        <span class="ca-request-route">${getLabel(r.fromNodeId)} → ${getLabel(r.toNodeId)}</span>
      </span>
      <button class="ca-request-approve" data-user-id="${r.userId}" data-node-id="${r.toNodeId}" title="Approve">✓</button>
      <button class="ca-request-reject"  data-user-id="${r.userId}" title="Reject">✗</button>
    `;
    li.querySelector(".ca-request-approve").addEventListener("click", () =>
      approveRequest(app, r.userId, r.toNodeId));
    li.querySelector(".ca-request-reject").addEventListener("click", () =>
      rejectRequest(app, r.userId));
    ul.appendChild(li);
  }

  existing.replaceWith(ul);
}

// ---------------------------------------------------------------------------
// Active node / view scene
// ---------------------------------------------------------------------------

/**
 * Sets the GM's current position flag to the clicked node.
 * Only updates the current user's flag — does not affect other players.
 * @param {ManagerApp} app
 * @param {string} nodeId
 * @returns {Promise<void>}
 */
export async function onSetActiveNode(app, nodeId) {
  if (!nodeId) return;
  await game.user.setFlag("click-adventure", "currentNodeId", nodeId);
  app.render({ force: true });
}

/**
 * Switches the GM's canvas view to the scene associated with the clicked node
 * AND sets that node as the active position.
 * Uses scene.view() — only the GM's perspective changes, players are unaffected.
 * @param {ManagerApp} app
 * @param {string} sceneId
 * @param {string} nodeId
 * @returns {Promise<void>}
 */
export async function onViewScene(app, sceneId, nodeId) {
  if (!sceneId) return;
  const scene = game.scenes.get(sceneId);
  if (!scene) {
    ui.notifications.warn("Click Adventure: Scene not found. Try running Update Scenes.");
    return;
  }
  await scene.view();
  if (nodeId) await onSetActiveNode(app, nodeId);
}

// ---------------------------------------------------------------------------
// Context menu & teleport
// ---------------------------------------------------------------------------

/**
 * Shows a context menu on right-click over a node with options to teleport players.
 * @param {ManagerApp} app
 * @param {MouseEvent} e
 * @param {string} nodeId
 */
export function onNodeContextMenu(app, e, nodeId) {
  document.querySelector(".ca-context-menu")?.remove();

  const players = game.users.filter(u => !u.isGM && u.active);
  if (players.length === 0) return;

  const { nodes } = getGraphData();
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return;

  const menu = document.createElement("div");
  menu.className = "ca-context-menu";
  menu.style.left = `${e.clientX}px`;
  menu.style.top  = `${e.clientY}px`;

  const header = document.createElement("div");
  header.className = "ca-context-menu-header";
  header.textContent = `Teleport to "${node.label || nodeId}"`;
  menu.appendChild(header);

  menu.appendChild(Object.assign(document.createElement("div"), { className: "ca-context-menu-divider" }));

  const sendAll = document.createElement("div");
  sendAll.className = "ca-context-menu-item ca-context-menu-item--send-all";
  sendAll.textContent = "Send all here";
  sendAll.addEventListener("click", () => {
    menu.remove();
    onSendAllToNode(app, node, players);
  });
  menu.appendChild(sendAll);

  menu.appendChild(Object.assign(document.createElement("div"), { className: "ca-context-menu-divider" }));

  for (const user of players) {
    const currentNodeId = user.getFlag("click-adventure", "currentNodeId");
    const isHere = currentNodeId === nodeId;

    const item = document.createElement("div");
    item.className = "ca-context-menu-item" + (isHere ? " ca-context-menu-item--active" : "");

    const dot = document.createElement("span");
    dot.className = "ca-context-menu-dot";
    dot.style.background = user.color?.css ?? user.color ?? "#fff";

    const label = document.createElement("span");
    label.textContent = user.name;

    item.appendChild(dot);
    item.appendChild(label);

    if (isHere) {
      const badge = document.createElement("span");
      badge.className = "ca-context-menu-badge";
      badge.textContent = "here";
      item.appendChild(badge);
    } else {
      item.addEventListener("click", () => {
        menu.remove();
        onTeleportPlayer(app, user, nodeId);
      });
    }

    menu.appendChild(item);
  }

  document.body.appendChild(menu);

  const closeMenu = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener("mousedown", closeMenu);
    }
  };
  // Delay one tick so this very mousedown event doesn't immediately close the menu
  setTimeout(() => document.addEventListener("mousedown", closeMenu), 0);
}

/**
 * Moves all provided active players to a target node.
 * Reuses the same flag + socket pattern as onTeleportPlayer.
 * @param {ManagerApp} app
 * @param {object} targetNode
 * @param {User[]} players
 * @returns {Promise<void>}
 */
export async function onSendAllToNode(app, targetNode, players) {
  for (const user of players) {
    // Teleport clears the "came from" context
    await user.unsetFlag("click-adventure", "previousNodeId");
    await user.setFlag("click-adventure", "currentNodeId", targetNode.id);

    if (targetNode.sceneId) {
      globalThis.ClickAdventure._socket.teleportUser(targetNode.sceneId, user.id);
    } else {
      globalThis.ClickAdventure._socket.notifyHudRefresh(user.id);
    }
  }

  patchOccupantAvatars(app);
}

/**
 * Teleports a specific player to a target node.
 * Updates their currentNodeId flag and notifies their client via socket.
 * @param {ManagerApp} app
 * @param {User} user
 * @param {string} nodeId
 * @returns {Promise<void>}
 */
export async function onTeleportPlayer(app, user, nodeId) {
  const { nodes } = getGraphData();
  const targetNode = nodes.find(n => n.id === nodeId);
  if (!targetNode) return;

  // Teleport clears the "came from" context
  await user.unsetFlag("click-adventure", "previousNodeId");
  await user.setFlag("click-adventure", "currentNodeId", nodeId);

  if (targetNode.sceneId) {
    await globalThis.ClickAdventure._socket.teleportUser(targetNode.sceneId, user.id);
  } else {
    await globalThis.ClickAdventure._socket.notifyHudRefresh(user.id);
  }

  patchOccupantAvatars(app);
}


