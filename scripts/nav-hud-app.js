/**
 * Floating navigation HUD displayed during gameplay.
 * Shows a single orb that expands a destination panel on click and initiates drag on hold.
 * Clicking an arrow navigates to the target graph node by replacing the background tile
 * texture in the currently active scene — the active scene itself never changes.
 * The current node position is tracked via graph.currentNodeId in the world setting.
 *
 * Lifecycle hook: renderNavHudApp
 */

import { getNodeActiveImage, isMultiPassage, getEffectiveDirection } from "./node-utils.js";

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
  }

  /**
   * Returns the graph as a plain POJO regardless of DataModel or raw object.
   * @returns {{ sceneId: string, currentNodeId: string, nodes: object[], links: object[] }}
   */
  _graphData() {
    const graph = game.settings.get("click-adventure", "graph");
    const raw = typeof graph?.toObject === "function" ? graph.toObject() : (graph ?? {});
    return {
      sceneId: raw.sceneId ?? "",
      currentNodeId: raw.currentNodeId ?? "",
      nodes: raw.nodes ?? [],
      links: raw.links ?? []
    };
  }

  /**
   * Finds the graph node the player is currently at, tracked via graph.currentNodeId.
   * Returns null when no navigation has occurred yet.
   * @returns {object|null}
   */
  _currentNode() {
    const { currentNodeId, nodes } = this._graphData();
    if (!currentNodeId) return null;
    return nodes.find(n => n.id === currentNodeId) ?? null;
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

    if (node) {
      const { nodes, links } = this._graphData();
      // seen deduplicates destinations that appear via multiple single-passage links
      const seen = new Set();

      for (const link of links) {
        if (isMultiPassage(link)) {
          // Each passage is listed as its own destination button (no dedup — distinct traversal options)
          for (const passage of link.passages) {
            const passDir = passage.direction ?? "both";
            if (passDir === "blocked") continue;
            let otherId = null;

            if (passDir === "both") {
              if (link.sourceId === node.id)      otherId = link.targetId;
              else if (link.targetId === node.id) otherId = link.sourceId;
            } else if (passDir === "forward" && link.sourceId === node.id) {
              otherId = link.targetId;
            } else if (passDir === "backward" && link.targetId === node.id) {
              otherId = link.sourceId;
            }

            if (!otherId) continue;
            const other = nodes.find(n => n.id === otherId);
            if (!other) continue;
            const label = passage.label
              ? `${other.label || other.id} (${passage.label})`
              : (other.label || other.id);
            availableDestinations.push({ id: other.id, label });
          }
        } else {
          // Single-passage: existing direction logic; dedup so the same node appears only once
          const dir = getEffectiveDirection(link);
          if (dir === "blocked") continue;
          let otherId = null;

          if (dir === "both") {
            if (link.sourceId === node.id)      otherId = link.targetId;
            else if (link.targetId === node.id) otherId = link.sourceId;
          } else if (dir === "forward" && link.sourceId === node.id) {
            otherId = link.targetId;
          } else if (dir === "backward" && link.targetId === node.id) {
            otherId = link.sourceId;
          }

          if (!otherId) continue;
          const other = nodes.find(n => n.id === otherId);
          if (other && !seen.has(other.id)) {
            seen.add(other.id);
            availableDestinations.push({ id: other.id, label: other.label || other.id });
          }
        }
      }
    }

    context.availableDestinations = availableDestinations;
    context.hasAnyDirection = availableDestinations.length > 0;
    // isOpen is managed via DOM class toggle — default false on each render
    context.isOpen = false;
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
        const nodeId = btn.dataset.nodeId;
        const { nodes } = this._graphData();
        const target = nodes.find(n => n.id === nodeId);
        if (target) {
          this._closePanelDOM();
          this._navigateTo(target);
        }
      });
    });

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
   * Navigates to a target node by replacing the background tile texture in the
   * currently active scene and updating currentNodeId in the graph setting.
   * Scene activation is intentionally never performed — the graph is permanently
   * bound to a single Foundry Scene.
   *
   * @param {object} targetNode — graph node with optional imageSrc
   * @returns {Promise<void>}
   */
  async _navigateTo(targetNode) {
    const scene = game.scenes.active;
    if (!scene) return;

    const tile = scene.tiles.contents[0];
    if (!tile) {
      ui.notifications.warn("No background tile found in current scene.");
      return;
    }

    const newSrc = getNodeActiveImage(targetNode) || "modules/click-adventure/assets/imgs/empty.webp";
    await tile.update({ "texture.src": newSrc });

    // Persist the new current node so the HUD directions refresh correctly
    const { sceneId, nodes, links } = this._graphData();
    await game.settings.set("click-adventure", "graph", {
      sceneId, currentNodeId: targetNode.id, nodes, links
    });

    // Notify the Manager so its current-node highlight updates immediately
    const manager = foundry.applications.instances.get("manager-app");
    if (manager?.rendered) manager.render({ force: true });

    this.render({ force: true });
  }
}
