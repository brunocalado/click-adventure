/**
 * Floating navigation HUD displayed during gameplay.
 * Shows a single orb that expands a destination panel on click and initiates drag on hold.
 * Clicking an arrow navigates to the target graph node by replacing the background tile
 * texture in the currently active scene — the active scene itself never changes.
 * The current node position is tracked via a per-user flag (click-adventure.currentNodeId).
 *
 * Lifecycle hook: renderNavHudApp
 */

import { MODULE_ID } from "./constants.js";
import {
  getGraphData, fireActiveItemMacro, fireNodeMacros, setNodeActiveImageIndex,
  setNodeActiveLinkedScene, getNodeActiveSceneId, setUserCurrentNode,
  iterPassagesFrom, evaluatePassageKeys
} from "./node-utils.js";
import { shouldLockOnArrival, isUserLocked } from "./autolock-utils.js";
import { openNodeJournal } from "./node-media.js";

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
    /** @type {boolean} — tracks open state of the peek panel across re-renders */
    this._peekPanelOpen = false;
    /**
     * Id of the node currently being peeked at, or null.
     * Not persisted — reset on navigation or scene change.
     * @type {string|null}
     */
    this._peekActiveNodeId = null;
    /**
     * Saved PIXI texture of the managed tile before a peek swap,
     * used to restore the original image when peeking stops.
     * @type {PIXI.Texture|null}
     */
    this._peekOriginalTexture = null;
    /** @type {number|undefined} — Foundry hook id for canvasReady, used to reset peek state. */
    this._onCanvasReadyHook = undefined;
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
   * Returns true if the current node has at least one passage back to targetNodeId that
   * this user could actually cross. Used to decide whether the "came from" indicator is
   * still meaningful. A Blocked passage is visible but impassable, so it is not a route;
   * a Custom one is, because the key may well be satisfied.
   *
   * @param {string} targetNodeId
   * @returns {boolean}
   */
  _canNavigateBackTo(targetNodeId) {
    const node = this._currentNode();
    if (!node || !targetNodeId) return false;
    const { links } = getGraphData();

    for (const { otherId, state } of iterPassagesFrom(node.id, links)) {
      if (otherId !== targetNodeId) continue;
      if (game.user.isGM) return true;
      if (state === "open" || state === "custom") return true;
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

    const node = this._currentNode();
    const availableDestinations = [];
    const { nodes, links } = getGraphData();

    if (node) {
      // A Blocked passage is hidden from players when another passage on the SAME link
      // already offers them a way to the same place — it would just be a disabled
      // duplicate of a door that leads nowhere useful from here. GMs always see every one.
      const linkHasOpenRoute = new Map();
      for (const { link, state } of iterPassagesFrom(node.id, links)) {
        if (state === "open" || state === "custom") linkHasOpenRoute.set(link, true);
      }

      // seen deduplicates destinations reached through several single-passage links
      const seen = new Set();

      for (const { link, passage, otherId, state, multi } of iterPassagesFrom(node.id, links)) {
        if (!game.user.isGM) {
          if (state === "secret") continue;
          if (state === "blocked" && linkHasOpenRoute.get(link)) continue;
          // A Custom passage set to stay hidden until unlocked is left out while its keys
          // are unsatisfied. Macro keys are not run here — see evaluatePassageKeys.
          if (state === "custom" && passage.lockedVisibility === "secret"
              && !(await evaluatePassageKeys(passage, { runMacros: false }))) continue;
        }

        // Multi-passage links list every passage separately: they are distinct routes,
        // and collapsing them would hide the one the player is looking for.
        if (!multi) {
          if (seen.has(otherId)) continue;
          seen.add(otherId);
        }

        const other = nodes.find(n => n.id === otherId);
        if (!other) continue;
        const navName = other.label || game.scenes.get(other.sceneId)?.name || other.id;
        const isPathOnly = multi && !game.user.isGM && passage.displayMode === "path-only";
        // Node name and passage name are kept apart so the HUD can stack them on
        // two lines — joined on one line they truncate before the passage is readable.
        const label    = isPathOnly ? (passage.label || navName) : navName;
        const sublabel = (multi && !isPathOnly) ? (passage.label || null) : null;

        availableDestinations.push({
          id: other.id,
          label,
          sublabel,
          passage,
          blocked: state === "blocked",
          secret:  state === "secret",
          custom:  state === "custom"
        });
      }
    }

    // ── Online players panel ──────────────────────────────────────────────
    const currentSceneId = node?.sceneId ?? null;

    // GM: only players currently in the same scene/node
    context.onlinePlayersInScene = (game.user.isGM && currentSceneId)
      ? game.users
          .filter(u => !u.isGM && u.active && u.id !== game.userId)
          .map(u => {
            const theirNodeId = u.getFlag("click-adventure", "currentNodeId");
            const theirNode   = theirNodeId ? nodes.find(n => n.id === theirNodeId) : null;
            if (theirNode?.sceneId !== currentSceneId) return null;
            const rawName = u.character?.name ?? u.name;
            const name = rawName.length > 18 ? rawName.slice(0, 18) + "…" : rawName;
            return { name, color: u.color?.css ?? "#aaaaaa" };
          })
          .filter(Boolean)
      : [];

    // Players: all other connected non-GM users with a preview of their current node image
    const showPlayerWhisper = game.settings.get("click-adventure", "showPlayerWhisper");
    context.onlineAllPlayers = (!game.user.isGM && showPlayerWhisper)
      ? game.users
          .filter(u => !u.isGM && u.active && u.id !== game.userId)
          .map(u => {
            const theirNodeId = u.getFlag("click-adventure", "currentNodeId");
            const theirNode   = theirNodeId ? nodes.find(n => n.id === theirNodeId) : null;
            const rawName = u.character?.name ?? u.name;
            const name = rawName.length > 18 ? rawName.slice(0, 18) + "…" : rawName;
            const theirImgs = Array.isArray(theirNode?.images) ? theirNode.images : [];
            const theirSrc  = theirImgs[theirNode?.activeImageIndex ?? 0]?.src ?? null;
            return {
              name,
              color: u.color?.css ?? "#aaaaaa",
              previewSrc: theirSrc,
              isVideo: theirSrc ? /\.(webm|mp4|ogg|ogv|mov)$/i.test(theirSrc) : false
            };
          })
      : [];
    // ─────────────────────────────────────────────────────────────────────

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
    // Autolock (the GM is holding this player in place) and Blocked (the passage itself
    // is shut) are unrelated conditions. Setting autolocked for both stacked a padlock on
    // top of the ban icon a Blocked destination already carries; the click guard below
    // handles Blocked on its own.
    const playerIsLocked = !game.user.isGM && isUserLocked(game.userId);
    context.playerIsLocked = playerIsLocked;
    for (const dest of availableDestinations) {
      dest.autolocked = playerIsLocked;
    }
    // ─────────────────────────────────────────────────────────────────────

    // ── Add preview image for each destination ────────────────────────────
    // Players only receive destination previews when the GM enables the
    // setting; the GM always sees them. Gating here (rather than in the
    // template) keeps the image URL out of the player's DOM entirely.
    const allowDestPreview =
      game.user.isGM || game.settings.get(MODULE_ID, "playerDestinationPreview");
    for (const dest of availableDestinations) {
      if (!allowDestPreview) { dest.previewSrc = null; dest.isVideo = false; continue; }
      const destNode  = nodes.find(n => n.id === dest.id);
      const destImgs  = Array.isArray(destNode?.images) ? destNode.images : [];
      const destImg   = destImgs[destNode?.activeImageIndex ?? 0] ?? null;
      const destSrc   = destImg?.src ?? null;
      dest.previewSrc = destSrc;
      dest.isVideo    = destSrc ? /\.(webm|mp4|ogg|ogv|mov)$/i.test(destSrc) : false;
    }
    // ─────────────────────────────────────────────────────────────────────

    // Kept on the instance so the click handler can reach the passage behind a button —
    // a Custom passage's keys are evaluated on the attempt to cross, not on render, and
    // the passage object itself never goes into the template.
    this._lastDestinations = availableDestinations;
    availableDestinations.forEach((dest, i) => { dest.destIndex = i; });

    context.availableDestinations = availableDestinations;
    context.hasAnyDirection = availableDestinations.length > 0;
    // isOpen is managed via DOM class toggle — default false on each render
    context.isOpen = false;

    // ── Peek panel — available when the current node is a camera room ─────
    const peekableNodes = [];
    if (node?.isCameraRoom) {
      for (const link of links) {
        if (link.type !== "peek" || link.sourceId !== node.id) continue;
        const peekNode = nodes.find(n => n.id === link.targetId);
        if (!peekNode) continue;
        const peekImgs = Array.isArray(peekNode.images) ? peekNode.images : [];
        const peekSrc  = peekImgs[peekNode.activeImageIndex ?? 0]?.src ?? null;
        peekableNodes.push({
          id:       peekNode.id,
          label:    peekNode.label || game.scenes.get(peekNode.sceneId)?.name || peekNode.id,
          imageSrc: peekSrc,
          isVideo:  peekSrc ? /\.(webm|mp4|ogg|ogv|mov)$/i.test(peekSrc) : false,
          isActive: this._peekActiveNodeId === peekNode.id
        });
      }
    }
    context.peekableNodes   = peekableNodes;
    context.hasPeekPanel    = peekableNodes.length > 0;
    context.peekButtonLabel = node?.cameraLabel?.trim() || "Cameras";
    // ─────────────────────────────────────────────────────────────────────

    context.isGM        = game.user.isGM;
    context.gmNavMode   = game.settings.get("click-adventure", "gmNavigationMode");
    context.isGuideMode = game.settings.get("click-adventure", "gmNavigationMode") === "guide";

    // ── GM node switcher — images and linked scenes for the current node ──
    if (game.user.isGM) {
      const currentNode    = this._currentNode();
      const images         = Array.isArray(currentNode?.images) ? currentNode.images : [];
      const linkedScenes   = Array.isArray(currentNode?.linkedScenes) ? currentNode.linkedScenes : [];
      const activeIdx      = currentNode?.activeImageIndex ?? 0;
      // An active linked scene wins over the image: what the node is showing is that
      // scene, so no image should carry the active badge while one is selected.
      const activeLinkedId = currentNode?.activeLinkedSceneId ?? null;

      context.nodeImages = images.map((img, i) => {
        const src = img.src ?? null;
        return {
          index:    i,
          label:    img.label || `Image ${i + 1}`,
          src,
          isVideo:  src ? /\.(webm|mp4|ogg|ogv|mov)$/i.test(src) : false,
          isActive: !activeLinkedId && i === activeIdx
        };
      });
      context.nodeLinkedScenes = linkedScenes.map((ls, i) => {
        const scene = game.scenes.get(ls.sceneId);
        return {
          index:      i,
          id:         ls.id,
          sceneId:    ls.sceneId,
          label:      ls.label || scene?.name || `Scene ${i + 1}`,
          previewSrc: scene?.thumbnail ?? null,
          isActive:   ls.id === activeLinkedId
        };
      });
      context.hasNodeSwitcher = images.length > 1 || (images.length > 0 && linkedScenes.length > 0);
    } else {
      context.hasNodeSwitcher = false;
    }
    // ─────────────────────────────────────────────────────────────────────

    // Orb style — per-client
    const orbStyle  = game.settings.get("click-adventure", "orbStyle");
    const orbType   = orbStyle.type     ?? "orb";
    const orbColor  = orbStyle.color    ?? "#d4a017";
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

    // When the canvas reloads (scene change) the PIXI tile is recreated, so the peek
    // texture swap is gone. Reset peek state so the HUD reflects this.
    this._onCanvasReadyHook = Hooks.on("canvasReady", () => {
      this._peekOriginalTexture = null;
      this._peekActiveNodeId    = null;
      this._peekPanelOpen       = false;

      // The click-adventure.js canvasReady handler (registered at module load, so it
      // always runs before this one) calls close() when the new scene doesn't belong
      // to the adventure — but without awaiting it. `this.rendered` can therefore still
      // read true here while that close() is still in flight, so re-rendering on that
      // flag alone would resurrect a HUD that's mid-close. Re-check scene membership
      // independently instead of trusting `rendered`.
      const scene = canvas.scene;
      const { nodes } = getGraphData();
      const belongsToAdventure = scene?.flags?.[MODULE_ID]?.isAdventureScene === true
        || nodes.some(n => n.sceneId === scene?.id
          || (n.linkedScenes ?? []).some(ls => ls.sceneId === scene?.id));
      if (this.rendered && belongsToAdventure) this.render({ force: true });
    });
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
    if (this._onCanvasReadyHook !== undefined) {
      Hooks.off("canvasReady", this._onCanvasReadyHook);
      this._onCanvasReadyHook = undefined;
    }
    this._restorePeekTexture();
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
      btn.addEventListener("click", async (e) => {
        if (e.target.closest(".ca-hud-preview-eye")) return;
        if (!game.user.isGM && btn.dataset.blocked === "true") {
          ui.notifications.warn("This path is not accessible.");
          return;
        }
        if (!game.user.isGM && btn.dataset.autolocked === "true") {
          ui.notifications.warn("This path is locked. Wait for the GM to release you.");
          return;
        }
        // Custom passages are checked here and nowhere else: this is the only moment the
        // player has actually tried to cross, so a key macro's side effects fire once,
        // on a real attempt, rather than every time the HUD lists its destinations.
        if (!game.user.isGM && btn.dataset.custom === "true") {
          const dest = this._lastDestinations?.[parseInt(btn.dataset.destIndex, 10)];
          if (!(await evaluatePassageKeys(dest?.passage))) {
            ui.notifications.warn("You don't have what's needed to pass.");
            return;
          }
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

    // ── Preview eye tooltips ──────────────────────────────────────────────
    const popup = html.querySelector(".ca-hud-preview-popup");
    if (popup) {
      html.querySelectorAll(".ca-hud-preview-eye").forEach(eye => {
        eye.addEventListener("mouseenter", e => {
          e.stopPropagation();
          const src = eye.dataset.previewSrc;
          if (!src) return;
          popup.innerHTML = "";
          if (eye.dataset.isVideo === "true") {
            const video = document.createElement("video");
            video.src = src;
            video.muted = true;
            video.loop = true;
            video.autoplay = true;
            video.playsInline = true;
            popup.appendChild(video);
          } else {
            const img = document.createElement("img");
            img.src = src;
            popup.appendChild(img);
          }
          const eyeRect = eye.getBoundingClientRect();
          const popupW  = 216;
          let left = eyeRect.right + 8;
          if (left + popupW > window.innerWidth) left = eyeRect.left - popupW - 8;
          popup.style.left = `${Math.max(0, left)}px`;
          popup.style.top  = `${eyeRect.top}px`;
          popup.classList.add("ca-hud-preview-popup--visible");
        });
        eye.addEventListener("mouseleave", () => {
          popup.classList.remove("ca-hud-preview-popup--visible");
          popup.innerHTML = "";
        });
      });
    }
    // ─────────────────────────────────────────────────────────────────────

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
      this._closePanelDOM();
      this._closePeekPanelDOM();
      this._toggleNodeSwitcherDOM();
    });

    html.querySelectorAll("[data-action='switch-image']").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const idx  = parseInt(btn.dataset.index, 10);
        const node = this._currentNode();
        if (!node) return;
        await this._guardSwitch(async () => {
          // Choosing an image cancels whichever linked scene was showing, so the two
          // switchers cannot both claim to be active.
          if (node.activeLinkedSceneId) await setNodeActiveLinkedScene(node.id, null);
          await setNodeActiveImageIndex(node.id, idx);
          this.render({ force: true });
        });
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
        await this._guardSwitch(async () => {
          // Persist the choice, the same way picking an image already does — otherwise
          // navigating away and back silently reverts to the node's own scene.
          if (node) await setNodeActiveLinkedScene(node.id, btn.dataset.linkedId ?? null);
          await this._showSceneForNode(scene, node);
          this.render({ force: true });
        });
      });
    });

    // Restore open state after re-render
    if (this._nodeSwitcherOpen) {
      html.querySelector(".ca-hud-node-switcher")?.classList.add("ca-hud-node-switcher--open");
    }
    // ─────────────────────────────────────────────────────────────────────

    // ── Peek panel ────────────────────────────────────────────────────────
    html.querySelector(".ca-hud-peek-toggle-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._closePanelDOM();
      this._closeNodeSwitcherDOM();
      this._togglePeekPanelDOM();
    });

    html.querySelectorAll("[data-action='peek-room']").forEach(btn => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (e.target.closest(".ca-hud-preview-eye")) return;
        const nodeId = btn.dataset.nodeId;
        if (this._peekActiveNodeId === nodeId) {
          // Clicking the active peek room again restores the original tile
          this._restorePeekTexture();
          this._peekActiveNodeId = null;
          html.querySelectorAll("[data-action='peek-room']")
            .forEach(b => b.classList.remove("ca-hud-ns-item--active"));
        } else {
          const { nodes } = getGraphData();
          const peekNode = nodes.find(n => n.id === nodeId);
          if (!peekNode) return;
          const peekImgs = Array.isArray(peekNode.images) ? peekNode.images : [];
          const peekSrc  = peekImgs[peekNode.activeImageIndex ?? 0]?.src ?? null;
          if (peekSrc) {
            await this._applyPeekTexture(peekSrc);
            this._peekActiveNodeId = nodeId;
            html.querySelectorAll("[data-action='peek-room']").forEach(b => {
              b.classList.toggle("ca-hud-ns-item--active", b.dataset.nodeId === nodeId);
            });
          }
        }
      });
    });

    html.querySelector("[data-action='peek-restore']")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._restorePeekTexture();
      this._peekActiveNodeId = null;
      html.querySelectorAll("[data-action='peek-room']")
        .forEach(b => b.classList.remove("ca-hud-ns-item--active"));
    });

    if (this._peekPanelOpen) {
      html.querySelector(".ca-hud-peek-panel")?.classList.add("ca-hud-peek-panel--open");
    }

    // Restore active peek button highlight and re-apply texture after re-render
    if (this._peekActiveNodeId) {
      html.querySelectorAll("[data-action='peek-room']").forEach(b => {
        b.classList.toggle("ca-hud-ns-item--active", b.dataset.nodeId === this._peekActiveNodeId);
      });
      const { nodes } = getGraphData();
      const peekNode = nodes.find(n => n.id === this._peekActiveNodeId);
      if (peekNode) {
        const peekImgs = Array.isArray(peekNode.images) ? peekNode.images : [];
        const peekSrc  = peekImgs[peekNode.activeImageIndex ?? 0]?.src ?? null;
        if (peekSrc) this._applyPeekTexture(peekSrc);
      }
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
   * Runs a scene/image switch, ignoring the click if the previous one is still in flight.
   *
   * Each switch is a chain of awaits — scene.view() or scene.activate(), then a socket
   * message per player on the node. Two overlapping chains can interleave and land out of
   * order on a player's client, leaving their canvas on the scene that was picked first
   * until they navigate away and back. A click during a switch is dropped rather than
   * queued: the GM double-clicking a switcher means "show this", not "show both".
   *
   * @param {() => Promise<void>} run
   * @returns {Promise<void>}
   */
  async _guardSwitch(run) {
    if (this._switchBusy) return;
    this._switchBusy = true;
    try { await run(); }
    finally { this._switchBusy = false; }
  }

  /**
   * Shows a scene to the GM and to every player standing on the given node.
   *
   * Which mechanism is used follows Guide Mode's own setting rather than always falling
   * back to per-client viewing: under "Activate (global)" the scene is activated, which
   * is also what starts a scene-bound playlist. Node-to-node navigation already honoured
   * that setting; switching a node's linked scenes did not, so scene music never played.
   *
   * @param {Scene} scene
   * @param {object|null} node - the node whose occupants should follow
   * @returns {Promise<void>}
   */
  async _showSceneForNode(scene, node) {
    const activateGlobally = game.user.isGM
      && game.settings.get(MODULE_ID, "gmNavigationMode") === "guide"
      && game.settings.get(MODULE_ID, "guideModeAction") === "activate";

    if (activateGlobally) {
      // scene.activate() is GM-only and reaches every connected client on its own.
      await scene.activate();
      return;
    }

    await scene.view();
    if (!node) return;
    for (const user of game.users) {
      if (user.isGM || !user.active) continue;
      if (user.getFlag(MODULE_ID, "currentNodeId") !== node.id) continue;
      await globalThis.ClickAdventure._socket.viewSceneForUser(scene.id, user.id);
    }
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
    this._closeNodeSwitcherDOM();
    this._closePeekPanelDOM();
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
   * Closes the GM node switcher panel.
   */
  _closeNodeSwitcherDOM() {
    const panel = this.element?.querySelector(".ca-hud-node-switcher");
    panel?.classList.remove("ca-hud-node-switcher--open");
    this._nodeSwitcherOpen = false;
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
   * Toggles the peek panel open/closed via CSS class.
   * Tracks state on the instance so it survives re-renders.
   */
  _togglePeekPanelDOM() {
    const panel = this.element?.querySelector(".ca-hud-peek-panel");
    if (!panel) return;
    this._peekPanelOpen = !this._peekPanelOpen;
    panel.classList.toggle("ca-hud-peek-panel--open", this._peekPanelOpen);
  }

  /**
   * Closes the peek panel and resets its open state.
   */
  _closePeekPanelDOM() {
    const panel = this.element?.querySelector(".ca-hud-peek-panel");
    panel?.classList.remove("ca-hud-peek-panel--open");
    this._peekPanelOpen = false;
  }

  /**
   * Swaps the managed background tile texture for the peeked room's active image.
   * Operates on the PIXI mesh directly so only this client sees the change — no
   * TileDocument update is triggered and no other clients are affected.
   * Saves the original texture so it can be restored later.
   *
   * @param {string} imageSrc — URL of the image to display
   * @returns {Promise<void>}
   */
  async _applyPeekTexture(imageSrc) {
    const tile = canvas.tiles?.placeables?.find(t => t.document.getFlag(MODULE_ID, "managed"));
    if (!tile?.mesh) return;
    if (!this._peekOriginalTexture) {
      this._peekOriginalTexture = tile.mesh.texture;
    }
    try {
      const tex = await PIXI.Assets.load(imageSrc);
      tile.mesh.texture = tex;
    } catch (err) {
      console.warn("Click Adventure | Peek texture swap failed:", err);
    }
  }

  /**
   * Restores the managed tile texture to its state before the peek swap.
   * No-op when no peek is active.
   */
  _restorePeekTexture() {
    if (!this._peekOriginalTexture) return;
    const tile = canvas.tiles?.placeables?.find(t => t.document.getFlag(MODULE_ID, "managed"));
    if (tile?.mesh) {
      tile.mesh.texture = this._peekOriginalTexture;
    }
    this._peekOriginalTexture = null;
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

    // Clear any active peek view before navigating away
    this._restorePeekTexture();
    this._peekActiveNodeId = null;
    this._peekPanelOpen    = false;

    // ── Capture where we are NOW as the previous location ─────────────
    const currentNode = this._currentNode();
    if (currentNode) {
      await game.user.setFlag("click-adventure", "previousNodeId", currentNode.id);
    } else {
      await game.user.unsetFlag("click-adventure", "previousNodeId");
    }
    // ──────────────────────────────────────────────────────────────────

    // The node shows whichever linked scene was last picked for it, falling back to its
    // own scene — so arriving looks the same as when the GM left it.
    const targetSceneId = getNodeActiveSceneId(targetNode);

    if (targetSceneId) {
      // Per-client scene view — does not affect other players' screens
      await globalThis.ClickAdventure._socket.viewSceneForUser(
        targetSceneId,
        game.userId
      );
    }

    // Per-user position — does not affect other players' currentNodeId flags
    await setUserCurrentNode(game.user, targetNode);

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
      await fireActiveItemMacro(targetNode, "gm-view", targetSceneId);
      await fireNodeMacros(targetNode, "gm-view");
    } else {
      await fireActiveItemMacro(targetNode, "player-view", targetSceneId);
      await fireNodeMacros(targetNode, "player-view");
    }
    // Arriving is a scene view for whoever navigated, GM or player alike.
    await openNodeJournal(targetNode, "view");
    // ─────────────────────────────────────────────────────────────────────

    // Request GM to move this player's token between scenes.
    if (!game.user.isGM) {
      const fromSceneId = currentNode ? getNodeActiveSceneId(currentNode) : null;
      const toSceneId   = targetSceneId;
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

      if (guideModeAction === "activate" && targetSceneId) {
        // Activate the scene globally — Foundry handles view for all connected users.
        // No per-player socket messages needed; scene.activate() is GM-only and
        // triggers canvasReady on all clients automatically.
        const scene = game.scenes.get(targetSceneId);
        if (scene) await scene.activate();

        await fireActiveItemMacro(targetNode, "gm-activate", targetSceneId);
        await fireNodeMacros(targetNode, "gm-activate");
        await openNodeJournal(targetNode, "activate");
        globalThis.ClickAdventure._socket.emitOpenJournal(targetNode.id);

        // Update all players' position flags and move their tokens to the activated scene.
        const { nodes: guideNodes } = getGraphData();
        const players = game.users.filter(u => !u.isGM && u.active);
        for (const user of players) {
          // Capture origin BEFORE overwriting the flag.
          const fromNodeId  = user.getFlag(MODULE_ID, "currentNodeId") ?? null;
          const fromNode    = guideNodes.find(n => n.id === fromNodeId);
          const fromSceneId = fromNode ? getNodeActiveSceneId(fromNode) : null;

          await user.unsetFlag(MODULE_ID, "previousNodeId");
          await setUserCurrentNode(user, targetNode);

          // GM is the executor — call directly (socket.io does not echo to emitter).
          await globalThis.ClickAdventure._socket._handleMoveToken({
            userId: user.id,
            fromSceneId,
            toSceneId: targetSceneId
          });
        }

      } else {
        // Default "view" behaviour: per-player socket teleport (existing code unchanged).
        const { nodes } = getGraphData();
        const players = game.users.filter(u => !u.isGM && u.active);
        for (const user of players) {
          // Capture origin BEFORE overwriting the flag.
          const fromNodeId  = user.getFlag(MODULE_ID, "currentNodeId") ?? null;
          const fromNode    = nodes.find(n => n.id === fromNodeId);
          const fromSceneId = fromNode ? getNodeActiveSceneId(fromNode) : null;

          await user.unsetFlag(MODULE_ID, "previousNodeId");
          await setUserCurrentNode(user, targetNode);

          if (targetSceneId) {
            globalThis.ClickAdventure._socket.teleportUser(targetSceneId, user.id, targetNode.id);
            // GM is already the executor — call the handler directly instead of emitting
            // to self (socket.io does not echo to the emitter).
            await globalThis.ClickAdventure._socket._handleMoveToken({
              userId:     user.id,
              fromSceneId,
              toSceneId:  targetSceneId
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
