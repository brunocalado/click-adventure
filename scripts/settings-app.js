/**
 * Settings popover for the Click Adventure module.
 * Opens on click of the gear button in the Manager toolbar; closes on outside click.
 * Anchored above the gear button so it does not cover the workspace.
 *
 * Lifecycle hook: renderSettingsApp
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class SettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static BASE_APPLICATION = ApplicationV2;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "settings-app",
    classes: ["click-adventure", "settings"],
    window: { frame: false, positioned: true },
    position: { width: 280, height: "auto" }
  };

  /** @override */
  static PARTS = {
    panel: { template: "modules/click-adventure/templates/settings-app.hbs" }
  };

  /**
   * @param {DOMRect} buttonRect — bounding rect of the gear button used to anchor the popover
   * @param {Function|null} [onClose] — callback fired when the popover closes itself on outside click
   * @param {object} [options]
   */
  constructor(buttonRect, onClose, options = {}) {
    super(options);
    /** @type {DOMRect} */
    this._buttonRect = buttonRect;
    /** @type {Function|null} */
    this._onCloseCallback = onClose ?? null;
    /** @type {Function|null} — document-level mousedown handler for outside-click detection */
    this._outsideClickHandler = null;
  }

  /**
   * Provides the current transitionType setting and all available transition options.
   * Triggered during the ApplicationV2 _prepareContext lifecycle stage.
   *
   * @override
   * @param {object} options
   * @returns {Promise<object>}
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.transitionType = game.settings.get("click-adventure", "transitionType");
    context.transitionOptions = [
      { value: "null",       label: "None" },
      { value: "fade",       label: "Fade" },
      { value: "swirl",      label: "Swirl" },
      { value: "waterDrop",  label: "Water Drop" },
      { value: "morph",      label: "Morph" },
      { value: "crosshatch", label: "Crosshatch" },
      { value: "wind",       label: "Wind" },
      { value: "waves",      label: "Waves" },
      { value: "whiteNoise", label: "White Noise" },
      { value: "hologram",   label: "Hologram" },
      { value: "hole",       label: "Hole" },
      { value: "holeSwirl",  label: "Hole Swirl" },
      { value: "glitch",     label: "Glitch" },
      { value: "dots",       label: "Dots" }
    ];
    return context;
  }

  /**
   * Re-parents to document.body so position:fixed works against the true viewport origin,
   * then anchors the panel above the gear button.
   * Registers a document-level mousedown to close on outside click.
   * Triggered during the ApplicationV2 _onFirstRender lifecycle stage.
   *
   * @override
   * @param {object} context
   * @param {object} options
   */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);

    if (this.element.parentElement !== document.body) {
      document.body.appendChild(this.element);
    }

    // Position above the button; offsetHeight may be 0 until after first paint,
    // so we fall back to a fixed offset that covers the typical panel height.
    const panelHeight = this.element.offsetHeight || 90;
    this.setPosition({
      left: Math.round(this._buttonRect.right - 280),
      top:  Math.round(this._buttonRect.top - panelHeight - 6)
    });

    this._outsideClickHandler = (e) => {
      if (!this.element.contains(e.target)) {
        this.close();
        this._onCloseCallback?.();
      }
    };
    // Delay one tick so this very click event does not immediately close the panel
    setTimeout(() => document.addEventListener("mousedown", this._outsideClickHandler), 0);
  }

  /**
   * Wires the transition select so changes are persisted immediately.
   * Triggered during the ApplicationV2 _onRender lifecycle stage.
   *
   * @override
   * @param {object} context
   * @param {object} options
   */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector(".ca-settings-transition")
      ?.addEventListener("change", async (e) => {
        await game.settings.set("click-adventure", "transitionType", e.target.value);
      });
  }

  /**
   * Removes the document-level outside-click listener on close.
   * Triggered during the ApplicationV2 _onClose lifecycle stage.
   *
   * @override
   * @param {object} options
   * @returns {Promise<void>}
   */
  async _onClose(options) {
    if (this._outsideClickHandler) {
      document.removeEventListener("mousedown", this._outsideClickHandler);
      this._outsideClickHandler = null;
    }
    await super._onClose(options);
  }
}
