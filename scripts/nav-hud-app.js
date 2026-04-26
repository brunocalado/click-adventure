/**
 * Floating navigation HUD displayed during gameplay.
 * Shows four 3D-styled directional arrow buttons around a central drag handle.
 * Clicking an arrow navigates to the scene linked via the corresponding anchor direction
 * from the currently active scene's graph node.
 *
 * If the target node has a linked Foundry Scene, that scene is activated directly.
 * Otherwise the background tile (index 0) in the current scene has its texture replaced
 * with the target node's imageSrc.
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
   * @returns {{ nodes: object[], links: object[] }}
   */
  _graphData() {
    const graph = game.settings.get("click-adventure", "graph");
    return typeof graph?.toObject === "function" ? graph.toObject() : (graph ?? { nodes: [], links: [] });
  }

  /**
   * Finds the graph node linked to the currently active Foundry scene.
   * @returns {object|null}
   */
  _currentNode() {
    const sceneId = game.scenes.active?.id;
    if (!sceneId) return null;
    const { nodes } = this._graphData();
    return nodes.find(n => n.sceneId === sceneId) ?? null;
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
   * Navigates to a target node. If the node has a linked Foundry Scene, activates it
   * directly. Otherwise replaces the background tile (index 0) texture with the node's
   * imageSrc and re-renders the HUD to reflect the new available directions.
   *
   * @param {object} targetNode — graph node with optional imageSrc and sceneId
   * @returns {Promise<void>}
   */
  async _navigateTo(targetNode) {
    // Prefer activating the linked Foundry scene when available
    if (targetNode.sceneId) {
      const targetScene = game.scenes.get(targetNode.sceneId);
      if (targetScene) {
        await targetScene.activate();
        this.render({ force: true });
        return;
      }
    }

    // Fallback: swap the texture of the first tile in the active scene
    const scene = game.scenes.active;
    if (!scene) return;

    const tile = scene.tiles.contents[0];
    if (!tile) {
      ui.notifications.warn("No background tile found in current scene.");
      return;
    }

    const newSrc = targetNode.imageSrc || "modules/click-adventure/assets/imgs/empty.webp";
    await tile.update({ "texture.src": newSrc });
    this.render({ force: true });
  }
}
