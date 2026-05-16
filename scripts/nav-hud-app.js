/**
 * Floating navigation HUD displayed during gameplay.
 * Shows a single orb that expands a destination panel on click and initiates drag on hold.
 * Clicking an arrow navigates to the target graph node by replacing the background tile
 * texture in the currently active scene — the active scene itself never changes.
 * The current node position is tracked via a per-user flag (click-adventure.currentNodeId).
 *
 * Lifecycle hook: renderNavHudApp
 */

import { isMultiPassage, getEffectiveDirection, getGraphData, fireActiveItemMacro, setNodeActiveImageIndex } from "./node-utils.js";
import { shouldLockOnArrival, isUserLocked } from "./autolock-utils.js";

// ── 3D gradient helpers (private to this module) ─────────────────────────────
function _hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function _lighten(hex, factor) {
  const { r, g, b } = _hexToRgb(hex);
  return `rgb(${Math.min(255, Math.round(r + (255 - r) * factor))},${Math.min(255, Math.round(g + (255 - g) * factor))},${Math.min(255, Math.round(b + (255 - b) * factor))})`;
}
function _darken(hex, factor) {
  const { r, g, b } = _hexToRgb(hex);
  return `rgb(${Math.round(r * (1 - factor))},${Math.round(g * (1 - factor))},${Math.round(b * (1 - factor))})`;
}
function _hexToRgba(hex, alpha) {
  const { r, g, b } = _hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}
function _buildOrbGradient(baseHex) {
  const light = _lighten(baseHex, 0.55);
  const dark  = _darken(baseHex,  0.45);
  return [
    `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.88) 0%, rgba(255,255,255,0) 42%)`,
    `radial-gradient(circle at 55% 118%, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 35%)`,
    `radial-gradient(circle at 40% 42%, ${light} 0%, ${baseHex} 48%, ${dark} 100%)`
  ].join(", ");
}
// ─────────────────────────────────────────────────────────────────────────────

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class NavHudApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static BASE_APPLICATION = ApplicationV2;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "nav-hud-app",
    classes: ["click-adventure", "nav-hud"],
    window: { frame: false, positioned: true },
    position: { width: 220, height: "auto", left: 120, top: 120 }
  };

  /** @override */
  static PARTS = {
    hud: {
      template: "modules/click-adventure/templates/nav-hud-app.hbs"
    }
  };

  constructor(options = {}) {
    super(options);
    /** @type {{ offsetX: number, offsetY: number }|null} */
    this._dragState = null;
    /** @type {boolean} — true once the hold threshold has been crossed */
    this._dragStarted = false;
    /** @type {number|null} — setTimeout handle for drag threshold detection */
    this._holdTimer = null;
    this._docMouseMove = this._onDocMouseMove.bind(this);
    this._docMouseUp   = this._onDocMouseUp.bind(this);
    /** @type {boolean} — true only when the current mousedown originated on the orb */
    this._orbMouseDownActive = false;
    /** @type {boolean} — tracks open state of the GM node switcher panel across re-renders */
    this._nodeSwitcherOpen = false;
  }



  /**
   * Resolves the node the current user occupies by reading their per-user flag.
   * Returns null when no position has been set yet (first session before ready hook fires).
   * @returns {object|null}
   */
  _currentNode() {
    const currentNodeId = game.user.getFlag("click-adventure", "currentNodeId");
    if (!currentNodeId) return null;
    const { nodes } = getGraphData();
    return nodes.find(n => n.id === currentNodeId) ?? null;
  }

  /**
   * Returns true if the current node has at least one traversable link to targetNodeId.
   * Used to validate whether the "came from" indicator is still valid.
   * Handles single-passage and multi-passage links, all direction states.
   * @param {string} targetNodeId
   * @returns {boolean}
   */
  _canNavigateBackTo(targetNodeId) {
    const node = this._currentNode();
    if (!node || !targetNodeId) return false;
    const { links } = getGraphData();

    for (const link of links) {
      if (isMultiPassage(link)) {
        for (const passage of link.passages) {
          const passDir = passage.direction ?? "both";
          if (passDir === "blocked") continue;
          if (passDir === "both") {
            if ((link.sourceId === node.id && link.targetId === targetNodeId) ||
                (link.targetId === node.id && link.sourceId === targetNodeId)) return true;
          } else if (passDir === "forward" && link.sourceId === node.id && link.targetId === targetNodeId) {
            return true;
          } else if (passDir === "backward" && link.targetId === node.id && link.sourceId === targetNodeId) {
            return true;
          }
        }
      } else {
        const dir = getEffectiveDirection(link);
        if (dir === "blocked") continue;
        if (dir === "both") {
          if ((link.sourceId === node.id && link.targetId === targetNodeId) ||
              (link.targetId === node.id && link.sourceId === targetNodeId)) return true;
        } else if (dir === "forward" && link.sourceId === node.id && link.targetId === targetNodeId) {
          return true;
        } else if (dir === "backward" && link.targetId === node.id && link.sourceId === targetNodeId) {
          return true;
        }
        // "locked" direction: link is visible but not navigable — NOT a valid back route
      }
    }
    return false;
  }

  /**
   * Builds a flat array of available destination nodes from the current node's outgoing links.
   * Replaces the previous direction-keyed object — direction metadata is no longer needed by the HUD.
   * Triggered during the ApplicationV2 _prepareContext lifecycle stage.
   *
   * @override
   * @param {object} options
   * @returns {Promise<object>}
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    // Lazy init: if the user has no currentNodeId yet, seed it from startNodeId now.
    // This handles players who joined after the ready hook ran or mid-session additions.
    const existingNodeId = game.user.getFlag("click-adventure", "currentNodeId");
    if (!existingNodeId) {
      const { startNodeId } = getGraphData();
      if (startNodeId) {
        await game.user.setFlag("click-adventure", "currentNodeId", startNodeId);
      }
    }

    const node = this._currentNode();
    const availableDestinations = [];

    if (node) {
      const { nodes, links } = getGraphData();
      // seen deduplicates destinations that appear via multiple single-passage links
      const seen = new Set();

      for (const link of links) {
        if (isMultiPassage(link)) {
          // Each passage is listed as its own destination button (no dedup — distinct traversal options)
          for (const passage of link.passages) {
            const passDir = passage.direction ?? "both";
            // Non-GMs never see blocked passages; GMs see them as "secret"
            if (passDir === "blocked" && !game.user.isGM) continue;
            let otherId = null;

            let passLocked = false;
            let passSecret = false;
            if (passDir === "both") {
              if (link.sourceId === node.id)      otherId = link.targetId;
              else if (link.targetId === node.id) otherId = link.sourceId;
            } else if (passDir === "forward" && link.sourceId === node.id) {
              otherId = link.targetId;
            } else if (passDir === "backward" && link.targetId === node.id) {
              otherId = link.sourceId;
            } else if (passDir === "locked") {
              // Visible in HUD but not navigable — mirrors single-passage "locked" behaviour
              if (link.sourceId === node.id)      otherId = link.targetId;
              else if (link.targetId === node.id) otherId = link.sourceId;
              passLocked = true;
            } else if (passDir === "blocked") {
              // Only reached by GM — shown as secret (purple + mask icon), fully navigable
              if (link.sourceId === node.id)      otherId = link.targetId;
              else if (link.targetId === node.id) otherId = link.sourceId;
              passSecret = true;
            }

            if (!otherId) continue;
            const other = nodes.find(n => n.id === otherId);
            if (!other) continue;
            const navName = other.label || game.scenes.get(other.sceneId)?.name || other.id;
            const isPathOnly = !game.user.isGM && passage.displayMode === "path-only";
            const label = isPathOnly
              ? (passage.label || navName)
              : passage.label
                  ? `${navName} (${passage.label})`
                  : navName;
            availableDestinations.push({ id: other.id, label, locked: passLocked, secret: passSecret });
          }
        } else {
          // Single-passage: existing direction logic; dedup so the same node appears only once
          const dir = getEffectiveDirection(link);
          // Non-GMs never see blocked links; GMs see them as "secret"
          if (dir === "blocked" && !game.user.isGM) continue;
          let otherId = null;

          if (dir === "both") {
            if (link.sourceId === node.id)      otherId = link.targetId;
            else if (link.targetId === node.id) otherId = link.sourceId;
          } else if (dir === "forward" && link.sourceId === node.id) {
            otherId = link.targetId;
          } else if (dir === "backward" && link.targetId === node.id) {
            otherId = link.sourceId;
          } else if (dir === "locked") {
            // Visible in HUD but not navigable — resolve otherId normally
            if (link.sourceId === node.id)      otherId = link.targetId;
            else if (link.targetId === node.id) otherId = link.sourceId;
          } else if (dir === "blocked") {
            // Only reached by GM — shown as secret (purple + mask icon), fully navigable
            if (link.sourceId === node.id)      otherId = link.targetId;
            else if (link.targetId === node.id) otherId = link.sourceId;
          }

          if (!otherId) continue;
          const other = nodes.find(n => n.id === otherId);
          if (other && !seen.has(other.id)) {
            seen.add(other.id);
            const navName = other.label || game.scenes.get(other.sceneId)?.name || other.id;
            availableDestinations.push({ id: other.id, label: navName, locked: dir === "locked", secret: dir === "blocked" });
          }
        }
      }
    }

    // ── Mark the destination the user came from ──────────────────────────
    const previousNodeId = game.user.getFlag("click-adventure", "previousNodeId") ?? null;
    for (const dest of availableDestinations) {
      dest.isOrigin = (
        previousNodeId !== null &&
        dest.id === previousNodeId &&
        this._canNavigateBackTo(previousNodeId)
      );
    }
    // ─────────────────────────────────────────────────────────────────────

    // ── Mark destinations blocked when the player is currently locked ─────
    const playerIsLocked = !game.user.isGM && isUserLocked(game.userId);
    context.playerIsLocked = playerIsLocked;
    for (const dest of availableDestinations) {
      dest.autolocked = playerIsLocked || dest.locked;
    }
    // ─────────────────────────────────────────────────────────────────────

    context.availableDestinations = availableDestinations;
    context.hasAnyDirection = availableDestinations.length > 0;
    // isOpen is managed via DOM class toggle — default false on each render
    context.isOpen = false;

    context.isGM        = game.user.isGM;
    context.gmNavMode   = game.settings.get("click-adventure", "gmNavigationMode");
    context.isGuideMode = game.settings.get("click-adventure", "gmNavigationMode") === "guide";

    // ── GM node switcher — images and linked scenes for the current node ──
    if (game.user.isGM) {
      const currentNode    = this._currentNode();
      const images         = Array.isArray(currentNode?.images) ? currentNode.images : [];
      const linkedScenes   = Array.isArray(currentNode?.linkedScenes) ? currentNode.linkedScenes : [];
      const activeIdx      = currentNode?.activeImageIndex ?? 0;

      context.nodeImages = images.map((img, i) => ({
        index:    i,
        label:    img.label || `Image ${i + 1}`,
        isActive: i === activeIdx
      }));
      context.nodeLinkedScenes = linkedScenes.map((ls, i) => ({
        index:     i,
        sceneId:   ls.sceneId,
        label:     ls.label || game.scenes.get(ls.sceneId)?.name || `Scene ${i + 1}`
      }));
      context.hasNodeSwitcher = images.length > 1 || (images.length > 0 && linkedScenes.length > 0);
    } else {
      context.hasNodeSwitcher = false;
    }
    // ─────────────────────────────────────────────────────────────────────

    // Orb style — per-client
    const orbStyle  = game.settings.get("click-adventure", "orbStyle");
    const orbType   = orbStyle.type     ?? "orb";
    const orbColor  = orbStyle.color    ?? "#3355aa";
    const orbImage  = orbStyle.orbImage ?? "";
    const scale     = orbStyle.size     ?? 1;
    const baseOrb   = 80;   // mirrors --ca-orb-size: 80px
    const baseInner = 28;   // mirrors --ca-orb-inner: 28px

    context.orbType     = orbType;
    context.orbColor    = orbColor;
    context.orbImage    = orbImage;
    context.orbSizePx   = Math.round(baseOrb   * scale);
    context.orbInnerPx  = Math.round(baseInner * scale);
    context.orbGradient = orbImage ? "" : _buildOrbGradient(orbColor);
    // Passed as CSS custom property so hover glow in CSS matches the user's color
    context.orbGlowRgba = _hexToRgba(orbColor, 0.5);

    return context;
  }

  /**
   * Attaches document-level drag listeners exactly once.
   * Triggered during the ApplicationV2 _onFirstRender lifecycle stage.
   *
   * @override
   * @param {object} context
   * @param {object} options
   */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    document.addEventListener("mousemove", this._docMouseMove);
    document.addEventListener("mouseup",   this._docMouseUp);

    // Re-parent to document.body so Foundry's UI layout cannot reflow this element.
    // ApplicationV2 may insert it into #interface; moving it here ensures position:fixed
    // works against the true viewport origin.
    if (this.element.parentElement !== document.body) {
      document.body.appendChild(this.element);
    }

    // Force ApplicationV2 to re-apply position styles now that the element
    // is correctly anchored in document.body under position:fixed.
    this.setPosition(this.constructor.DEFAULT_OPTIONS.position);
  }

  /**
   * Removes document-level listeners to prevent leaks.
   * Triggered during the ApplicationV2 _onClose lifecycle stage.
   *
   * @override
   * @param {object} options
   * @returns {Promise<void>}
   */
  async _onClose(options) {
    document.removeEventListener("mousemove", this._docMouseMove);
    document.removeEventListener("mouseup",   this._docMouseUp);
    globalThis.ClickAdventure._hud = null;
    await super._onClose(options);
  }

  /**
   * Wires destination button clicks and the orb mousedown after every render.
   * The orb uses a hold-threshold pattern: release before 200ms = click (toggle panel);
   * hold beyond 200ms = drag mode.
   * Triggered during the ApplicationV2 _onRender lifecycle stage.
   *
   * @override
   * @param {object} context
   * @param {object} options
   */
  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;

    html.querySelectorAll(".ca-hud-dest-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        if (!game.user.isGM && btn.dataset.locked === "true") {
          ui.notifications.warn("This path is not accessible.");
          return;
        }
        if (!game.user.isGM && btn.dataset.autolocked === "true") {
          ui.notifications.warn("This path is locked. Wait for the GM to release you.");
          return;
        }
        const nodeId = btn.dataset.nodeId;
        const { nodes } = getGraphData();
        const target = nodes.find(n => n.id === nodeId);
        if (target) {
          this._closePanelDOM();
          this._navigateTo(target);
        }
      });
    });

    html.querySelector(".ca-hud-manager-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      globalThis.ClickAdventure.Manager();
    });

    html.querySelector(".ca-hud-mode-btn")?.addEventListener("click", async (e) => {
      e.stopPropagation();
      const next = game.settings.get("click-adventure", "gmNavigationMode") === "solo" ? "guide" : "solo";
      await game.settings.set("click-adventure", "gmNavigationMode", next);
      this.render({ force: true });
    });

    // ── GM node switcher ──────────────────────────────────────────────────
    html.querySelector(".ca-hud-ns-toggle-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._toggleNodeSwitcherDOM();
    });

    html.querySelectorAll("[data-action='switch-image']").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const idx  = parseInt(btn.dataset.index, 10);
        const node = this._currentNode();
        if (!node) return;
        await setNodeActiveImageIndex(node.id, idx);
        this.render({ force: true });
      });
    });

    html.querySelectorAll("[data-action='switch-linked-scene']").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const sceneId = btn.dataset.sceneId;
        const scene   = game.scenes.get(sceneId);
        if (!scene) {
          ui.notifications.error("Click Adventure: Linked scene not found. It may have been deleted.");
          return;
        }
        const node = this._currentNode();

        // GM: switch view locally
        await scene.view();

        // Players on this node: send via socket
        if (node) {
          for (const user of game.users) {
            if (user.isGM || !user.active) continue;
            if (user.getFlag("click-adventure", "currentNodeId") !== node.id) continue;
            await globalThis.ClickAdventure._socket.viewSceneForUser(sceneId, user.id);
          }
        }
      });
    });

    // Restore open state after re-render
    if (this._nodeSwitcherOpen) {
      html.querySelector(".ca-hud-node-switcher")?.classList.add("ca-hud-node-switcher--open");
    }
    // ─────────────────────────────────────────────────────────────────────

    const orb = html.querySelector(".ca-hud-orb");
    if (!orb) {
      console.warn("NavHudApp | .ca-hud-orb not found — interaction will not work.");
      return;
    }

    orb.addEventListener("mousedown", e => {
      if (e.button !== 0) return;
      e.preventDefault();

      this._orbMouseDownActive = true;
      this._dragStarted = false;
      const rect = this.element.getBoundingClientRect();

      // Crossing the threshold commits to drag; releasing before it is treated as a click
      this._holdTimer = setTimeout(() => {
        this._dragStarted = true;
        this._dragState = {
          offsetX: e.clientX - rect.left,
          offsetY: e.clientY - rect.top
        };
        orb.classList.add("ca-hud-orb--dragging");
      }, 200);
    });
  }

  /**
   * Moves the HUD while dragging.
   * @param {MouseEvent} e
   */
  _onDocMouseMove(e) {
    if (!this._dragState || !this._dragStarted) return;
    const x = e.clientX - this._dragState.offsetX;
    const y = e.clientY - this._dragState.offsetY;
    this.setPosition({ left: x, top: y });
  }

  /**
   * Ends drag or triggers panel toggle depending on whether the hold threshold was crossed.
   * @param {MouseEvent} e
   */
  _onDocMouseUp(e) {
    if (!this._orbMouseDownActive) return;
    this._orbMouseDownActive = false;

    if (this._holdTimer) {
      clearTimeout(this._holdTimer);
      this._holdTimer = null;
    }

    if (this._dragStarted) {
      this._dragStarted = false;
      this._dragState = null;
      const orb = this.element?.querySelector(".ca-hud-orb");
      orb?.classList.remove("ca-hud-orb--dragging");
      return;
    }

    // Released before threshold — treat as click to toggle the destinations panel.
    this._togglePanelDOM();
  }

  /**
   * Toggles the destinations panel open/closed via CSS class.
   * Direct DOM manipulation avoids a full ApplicationV2 re-render for a UI-only state change.
   */
  _togglePanelDOM() {
    const panel = this.element?.querySelector(".ca-hud-destinations");
    if (!panel) return;
    panel.classList.toggle("ca-hud-destinations--open");
  }

  /**
   * Closes the destinations panel.
   */
  _closePanelDOM() {
    const panel = this.element?.querySelector(".ca-hud-destinations");
    panel?.classList.remove("ca-hud-destinations--open");
  }

  /**
   * Toggles the GM node switcher panel open/closed via CSS class.
   * Tracks state on the instance so it survives re-renders.
   */
  _toggleNodeSwitcherDOM() {
    const panel = this.element?.querySelector(".ca-hud-node-switcher");
    if (!panel) return;
    this._nodeSwitcherOpen = !this._nodeSwitcherOpen;
    panel.classList.toggle("ca-hud-node-switcher--open", this._nodeSwitcherOpen);
  }

  /**
   * Navigates the current user to a target node.
   * - In "gated" mode, non-GM players send a request to the GM instead of navigating directly.
   * - Scene transition is per-client only (scene.view() via socket), never global.
   * - Persists the new position in the user's own flag (per-user, not global).
   *
   * @param {object} targetNode - graph node with optional sceneId
   * @returns {Promise<void>}
   */
  async _navigateTo(targetNode) {
    const mode = game.settings.get("click-adventure", "navigationMode");

    if (!game.user.isGM && mode === "gated") {
      const currentNode = this._currentNode();
      globalThis.ClickAdventure._socket.requestNavigation({
        fromNodeId: currentNode?.id ?? null,
        toNodeId:   targetNode.id
      });
      ui.notifications.info("Navigation request sent. Waiting for GM approval.");
      return;
    }

    // ── Capture where we are NOW as the previous location ─────────────
    const currentNode = this._currentNode();
    if (currentNode) {
      await game.user.setFlag("click-adventure", "previousNodeId", currentNode.id);
    } else {
      await game.user.unsetFlag("click-adventure", "previousNodeId");
    }
    // ──────────────────────────────────────────────────────────────────

    if (targetNode.sceneId) {
      // Per-client scene view — does not affect other players' screens
      await globalThis.ClickAdventure._socket.viewSceneForUser(
        targetNode.sceneId,
        game.userId
      );
    }

    // Per-user position — does not affect other players' currentNodeId flags
    await game.user.setFlag("click-adventure", "currentNodeId", targetNode.id);

    // ── Request autolock if the destination node requires it ──────────────
    // Non-GM only: ask the GM (server) to register the lock since only GM
    // can write world-scoped settings (lockedUsers).
    if (!game.user.isGM && shouldLockOnArrival(targetNode)) {
      globalThis.ClickAdventure._socket.emitRequestLock({
        userId: game.userId,
        nodeId: targetNode.id
      });
    }
    // ─────────────────────────────────────────────────────────────────────

    // ── Fire arrival macros ───────────────────────────────────────────────
    if (game.user.isGM) {
      await fireActiveItemMacro(targetNode, "gm-view", targetNode.sceneId ?? null);
      await fireActiveItemMacro(targetNode, "gm-any",  targetNode.sceneId ?? null);
    } else {
      await fireActiveItemMacro(targetNode, "player-view", targetNode.sceneId ?? null);
    }
    // ─────────────────────────────────────────────────────────────────────

    // Request GM to move this player's token between scenes.
    if (!game.user.isGM) {
      const fromSceneId = currentNode?.sceneId ?? null;
      const toSceneId   = targetNode.sceneId   ?? null;
      if (toSceneId) {
        globalThis.ClickAdventure._socket.emitMoveToken({
          userId:      game.userId,
          fromSceneId,
          toSceneId
        });
      }
    }

    // Guide mode: drag all active non-GM players to the same node, bypassing gated mode.
    if (game.user.isGM && game.settings.get("click-adventure", "gmNavigationMode") === "guide") {
      const guideModeAction = game.settings.get("click-adventure", "guideModeAction");

      if (guideModeAction === "activate" && targetNode.sceneId) {
        // Activate the scene globally — Foundry handles view for all connected users.
        // No per-player socket messages needed; scene.activate() is GM-only and
        // triggers canvasReady on all clients automatically.
        const scene = game.scenes.get(targetNode.sceneId);
        if (scene) await scene.activate();

        await fireActiveItemMacro(targetNode, "gm-activate", targetNode.sceneId ?? null);
        await fireActiveItemMacro(targetNode, "gm-any",       targetNode.sceneId ?? null);

        // Update all players' position flags and move their tokens to the activated scene.
        const { nodes: guideNodes } = getGraphData();
        const players = game.users.filter(u => !u.isGM && u.active);
        for (const user of players) {
          // Capture origin BEFORE overwriting the flag.
          const fromNodeId  = user.getFlag("click-adventure", "currentNodeId") ?? null;
          const fromNode    = guideNodes.find(n => n.id === fromNodeId);
          const fromSceneId = fromNode?.sceneId ?? null;

          await user.unsetFlag("click-adventure", "previousNodeId");
          await user.setFlag("click-adventure", "currentNodeId", targetNode.id);

          // GM is the executor — call directly (socket.io does not echo to emitter).
          await globalThis.ClickAdventure._socket._handleMoveToken({
            userId: user.id,
            fromSceneId,
            toSceneId: targetNode.sceneId
          });
        }

      } else {
        // Default "view" behaviour: per-player socket teleport (existing code unchanged).
        const { nodes } = getGraphData();
        const players = game.users.filter(u => !u.isGM && u.active);
        for (const user of players) {
          // Capture origin BEFORE overwriting the flag.
          const fromNodeId  = user.getFlag("click-adventure", "currentNodeId") ?? null;
          const fromNode    = nodes.find(n => n.id === fromNodeId);
          const fromSceneId = fromNode?.sceneId ?? null;

          await user.unsetFlag("click-adventure", "previousNodeId");
          await user.setFlag("click-adventure", "currentNodeId", targetNode.id);

          if (targetNode.sceneId) {
            globalThis.ClickAdventure._socket.teleportUser(targetNode.sceneId, user.id, targetNode.id);
            // GM is already the executor — call the handler directly instead of emitting
            // to self (socket.io does not echo to the emitter).
            await globalThis.ClickAdventure._socket._handleMoveToken({
              userId:     user.id,
              fromSceneId,
              toSceneId:  targetNode.sceneId
            });
          } else {
            globalThis.ClickAdventure._socket.notifyHudRefresh(user.id);
          }
        }
      }
    }

    // Notify GM's manager of position change (lightweight DOM patch, no full re-render)
    globalThis.ClickAdventure._socket.emitPlayerMoved(targetNode.id);

    // Patch the manager locally if this client is also the GM
    const manager = foundry.applications.instances.get("manager-app");
    if (manager?.rendered) manager._patchOccupantAvatars();

    this.render({ force: true });
  }
}
