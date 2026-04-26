/**
 * Floating navigation HUD displayed during gameplay.
 * Shows four 3D-styled directional arrow buttons around a central drag handle.
 * Clicking an arrow navigates to the adjacent graph node by replacing the background tile
 * texture in the currently active scene — the active scene itself never changes.
 * The current node position is tracked via graph.currentNodeId in the world setting.
 *
 * Lifecycle hook: renderNavHudApp
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class NavHudApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static BASE_APPLICATION = ApplicationV2;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "nav-hud-app",
    classes: ["click-adventure", "nav-hud"],
    window: { frame: false, positioned: true },
    position: { width: 160, height: 160, left: 120, top: 120 }
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
    this._docMouseMove = this._onDocMouseMove.bind(this);
    this._docMouseUp   = this._onDocMouseUp.bind(this);
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
   * Builds available directions from the current node's outgoing links.
   * Keys are "top", "right", "bottom", "left"; values are target nodes or null.
   * Triggered during the ApplicationV2 _prepareContext lifecycle stage.
   *
   * @override
   * @param {object} options
   * @returns {Promise<object>}
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const node = this._currentNode();
    const directions = { top: null, right: null, bottom: null, left: null };

    if (node) {
      const { nodes, links } = this._graphData();
      for (const link of links) {
        if (link.sourceId === node.id && directions[link.sourceAnchor] === null) {
          const target = nodes.find(n => n.id === link.targetId);
          if (target) directions[link.sourceAnchor] = target;
        }
      }
    }

    context.directions = directions;
    context.hasAnyDirection = Object.values(directions).some(Boolean);
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
   * Wires direction button clicks and the central drag handle after every render.
   * Triggered during the ApplicationV2 _onRender lifecycle stage.
   *
   * @override
   * @param {object} context
   * @param {object} options
   */
  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;

    html.querySelectorAll("[data-direction]").forEach(btn => {
      btn.addEventListener("click", () => {
        const dir = btn.dataset.direction;
        const target = context.directions[dir];
        if (target) this._navigateTo(target);
      });
    });

    const handle = html.querySelector(".ca-hud-handle");
    if (!handle) {
      console.warn("NavHudApp | .ca-hud-handle not found — drag will not work.");
      return;
    }
    handle.addEventListener("mousedown", e => {
      e.preventDefault();
      const rect = this.element.getBoundingClientRect();
      this._dragState = {
        offsetX: e.clientX - rect.left,
        offsetY: e.clientY - rect.top
      };
    });
  }

  /**
   * @param {MouseEvent} e
   */
  _onDocMouseMove(e) {
    if (!this._dragState) return;
    const x = e.clientX - this._dragState.offsetX;
    const y = e.clientY - this._dragState.offsetY;
    this.setPosition({ left: x, top: y });
  }

  /**
   * @param {MouseEvent} e
   */
  _onDocMouseUp(e) {
    this._dragState = null;
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

    const newSrc = targetNode.imageSrc || "modules/click-adventure/assets/imgs/empty.webp";
    await tile.update({ "texture.src": newSrc });

    // Persist the new current node so the HUD directions refresh correctly
    const { sceneId, nodes, links } = this._graphData();
    await game.settings.set("click-adventure", "graph", {
      sceneId, currentNodeId: targetNode.id, nodes, links
    });

    this.render({ force: true });
  }
}
