/**
 * Settings window for the Click Adventure module.
 * Opens on click of the gear button in the Manager toolbar.
 * Replaces the previous frameless outside-click popover.
 *
 * Lifecycle hook: renderSettingsApp
 */


import { onResetGraph } from "./manager-scene-ops.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class SettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static BASE_APPLICATION = ApplicationV2;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "settings-app",
    classes: ["click-adventure", "settings"],
    window: { title: "Click Adventure — Settings", resizable: false },
    position: { width: 420, height: "auto" }
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

    context.hudVisibility = game.settings.get("click-adventure", "hudVisibility");
    context.hudVisibilityOptions = [
      { value: "all",     label: "All players" },
      { value: "gm-only", label: "GM only" }
    ];

    context.useDefaultTokenPositions = game.settings.get("click-adventure", "useDefaultTokenPositions");
    context.showPlayerWhisper = game.settings.get("click-adventure", "showPlayerWhisper");
    context.playerDestinationPreview = game.settings.get("click-adventure", "playerDestinationPreview");

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

    // Button groups (HUD Visibility + Guide Mode)
    this.element.querySelectorAll(".ca-btn-group").forEach(group => {
      group.querySelectorAll(".ca-btn-group-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const setting = group.dataset.setting;
          const value   = btn.dataset.value;

          await game.settings.set("click-adventure", setting, value);

          group.querySelectorAll(".ca-btn-group-btn").forEach(b =>
            b.classList.toggle("ca-btn-group-btn--active", b === btn)
          );
        });
      });
    });

    // Toggle buttons — generic handler for any boolean setting using data-setting
    this.element.querySelectorAll(".ca-toggle-btn[data-setting]").forEach(btn => {
      btn.addEventListener("click", async function () {
        const setting = this.dataset.setting;
        const next    = !game.settings.get("click-adventure", setting);
        await game.settings.set("click-adventure", setting, next);
        this.classList.toggle("ca-toggle-btn--active", next);
        this.textContent = next ? "Enabled" : "Disabled";
      });
    });

    this.element.querySelector(".ca-capture-token-pos")
      ?.addEventListener("click", async () => {
        const scene = canvas.scene;
        if (!scene) {
          ui.notifications.warn("Click Adventure: No active scene on canvas.");
          return;
        }

        const current = game.settings.get("click-adventure", "defaultTokenPositions") ?? {};
        const updated = { ...current };
        let count = 0;

        for (const token of scene.tokens) {
          if (!token.actorId) continue;
          const user = game.users.find(u => u.character?.id === token.actorId);
          if (!user) continue;
          updated[user.id] = { x: token.x, y: token.y };
          count++;
        }

        if (count === 0) {
          ui.notifications.warn("Click Adventure: No linked-actor tokens found in the current scene.");
          return;
        }

        await game.settings.set("click-adventure", "defaultTokenPositions", updated);

        // Auto-enable the toggle if it was off
        const wasEnabled = game.settings.get("click-adventure", "useDefaultTokenPositions");
        if (!wasEnabled) {
          await game.settings.set("click-adventure", "useDefaultTokenPositions", true);
          const toggleBtn = this.element.querySelector(".ca-toggle-btn");
          if (toggleBtn) {
            toggleBtn.classList.add("ca-toggle-btn--active");
            toggleBtn.textContent = "Enabled";
          }
        }

        ui.notifications.info(`Click Adventure: Saved default positions for ${count} player(s). Token placement enabled.`);
      });

    this.element.querySelector(".ca-reset-graph")
      ?.addEventListener("click", () => {
        const managerApp = globalThis.ClickAdventure?._manager;
        onResetGraph(managerApp ?? { render: () => {} });
      });
  }
}
