/**
 * Tabbed help window for the Click Adventure Manager.
 * Opens on click of the Instructions button; closes via the standard Foundry window X.
 * Replaces the previous frameless mouseenter/mouseleave popover.
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
    window: { title: "Click Adventure — Help", resizable: false },
    position: { width: 480, height: 560 }
  };

  /** @override */
  static PARTS = {
    content: { template: "modules/click-adventure/templates/instructions-app.hbs" }
  };

  constructor(options = {}) {
    super(options);
    /** @type {string} — ID of the currently active tab */
    this._activeTab = "controls";
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.activeTab = this._activeTab;
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);

    this.element.querySelectorAll(".ca-instr-tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        if (tab === this._activeTab) return;
        this._activeTab = tab;

        this.element.querySelectorAll(".ca-instr-tab-btn").forEach(b =>
          b.classList.toggle("ca-instr-tab-btn--active", b.dataset.tab === tab)
        );
        this.element.querySelectorAll(".ca-instr-panel").forEach(p =>
          p.classList.toggle("ca-instr-panel--active", p.dataset.panel === tab)
        );
      });
    });
  }
}
