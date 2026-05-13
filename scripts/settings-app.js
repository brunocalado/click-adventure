/**
 * Settings window for the Click Adventure module.
 * Opens on click of the gear button in the Manager toolbar.
 * Replaces the previous frameless outside-click popover.
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
    window: { title: "Click Adventure — Settings", resizable: false },
    position: { width: 360, height: "auto" }
  };

  /** @override */
  static PARTS = {
    panel: { template: "modules/click-adventure/templates/settings-app.hbs" }
  };

  /**
   * Provides the current settings values and all available transition options.
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

    context.guideModeAction = game.settings.get("click-adventure", "guideModeAction");

    return context;
  }

  /**
   * Wires the transition select and guide-mode-action select so changes
   * are persisted immediately.
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

    this.element.querySelector(".ca-settings-guide-action")
      ?.addEventListener("change", async (e) => {
        await game.settings.set("click-adventure", "guideModeAction", e.target.value);
      });
  }
}
