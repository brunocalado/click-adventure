/**
 * Read-only popover listing keyboard shortcuts and link types for the Manager toolbar.
 * Opens on mouseenter of the Instructions button; closes on mouseleave.
 * No persistent state — purely informational overlay.
 *
 * Lifecycle hook: renderInstructionsApp
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class InstructionsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static BASE_APPLICATION = ApplicationV2;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "instructions-app",
    classes: ["click-adventure", "instructions"],
    window: { frame: false, positioned: true },
    position: { width: 320, height: "auto" }
  };

  /** @override */
  static PARTS = {
    popover: { template: "modules/click-adventure/templates/instructions-app.hbs" }
  };

  /**
   * @param {DOMRect} buttonRect — bounding rect of the Instructions button used to anchor the popover
   * @param {Function|null} [onClose] — callback fired when the popover closes itself on mouseleave
   * @param {object} [options]
   */
  constructor(buttonRect, onClose, options = {}) {
    super(options);
    /** @type {DOMRect} */
    this._buttonRect = buttonRect;
    /** @type {Function|null} */
    this._onCloseCallback = onClose ?? null;
  }

  /**
   * Positions the popover directly below the Instructions button after first paint.
   * Re-parented to document.body (same technique as NavHudApp) so position:fixed works
   * against the true viewport origin and is not clipped by the Manager window.
   * Wires mouseleave so the popover closes immediately when the pointer leaves it.
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

    this.setPosition({
      left: Math.round(this._buttonRect.left),
      top:  Math.round(this._buttonRect.bottom + 6)
    });

    this.element.addEventListener("mouseleave", () => {
      this.close();
      this._onCloseCallback?.();
    });
  }
}
