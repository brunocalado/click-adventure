/**
 * HudStyleApp — GM-only configuration window for the navigation HUD button's visual style.
 * Accessible via Foundry's Module Settings page (registered via game.settings.registerMenu).
 * Saves to the world-scoped "orbStyle" setting; changes apply to all connected clients.
 * Changes are applied to the live HUD immediately via a forced re-render.
 *
 * Lifecycle hook: renderHudStyleApp
 */

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

export class HudStyleApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static BASE_APPLICATION = ApplicationV2;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "hud-style-app",
    classes: ["click-adventure", "hud-style"],
    window: { frame: true, title: "HUD Button Style", resizable: false },
    position: { width: 340, height: "auto" }
  };

  /** @override */
  static PARTS = {
    form: { template: "modules/click-adventure/templates/hud-style-app.hbs" }
  };

  /**
   * Provides current orbStyle values and computed preview gradient to the template.
   * @override
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const style = game.settings.get("click-adventure", "orbStyle");
    context.orbType     = style.type     ?? "orb";
    context.orbSize     = style.size     ?? 1;
    context.orbColor    = style.color    ?? "#3355aa";
    context.orbImage    = style.orbImage ?? "";
    context.orbGradient = _buildOrbGradient(context.orbColor); // still used by live HUD
    context.isGM        = game.user.isGM;

    context.typeOptions = [
      { value: "orb",    label: "Orb"    },
      { value: "square", label: "Square" }
    ];
    return context;
  }

  /**
   * Wires all controls so changes persist immediately and refresh the live HUD.
   * @override
   */
  _onRender(context, options) {
    super._onRender(context, options);
    if (!game.user.isGM) return;   // players see the form but cannot interact
    const html = this.element;

    // Type buttons
    html.querySelectorAll(".ca-os-type-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const style = game.settings.get("click-adventure", "orbStyle");
        await game.settings.set("click-adventure", "orbStyle", { ...style, type: btn.dataset.type });
        this.render({ force: true });
        this._refreshHud();
      });
    });

    // Size slider — update label in real time, save on input
    const sizeInput = html.querySelector(".ca-os-size");
    const sizeLabel = html.querySelector(".ca-os-size-label");
    if (sizeInput) {
      sizeInput.addEventListener("input", async (e) => {
        if (sizeLabel) sizeLabel.textContent = `${parseFloat(e.target.value)}×`;
        const style = game.settings.get("click-adventure", "orbStyle");
        await game.settings.set("click-adventure", "orbStyle", { ...style, size: parseFloat(e.target.value) });
        this._refreshHud();
      });
    }

    // Color picker
    const colorInput = html.querySelector(".ca-os-color");
    if (colorInput) {
      colorInput.addEventListener("input", async (e) => {
        const style = game.settings.get("click-adventure", "orbStyle");
        await game.settings.set("click-adventure", "orbStyle", { ...style, color: e.target.value });
        // Update preview color without full re-render
        const previewShape = html.querySelector(".ca-os-preview-shape");
        if (previewShape) previewShape.style.backgroundColor = e.target.value;
        this._refreshHud();
      });
    }

    // Image browse button
    html.querySelector(".ca-os-image-browse")?.addEventListener("click", () => {
      const FilePickerClass = foundry.applications.apps.FilePicker.implementation
        ?? foundry.applications.apps.FilePicker;
      const current = game.settings.get("click-adventure", "orbStyle").orbImage ?? "";
      new FilePickerClass({
        type: "image",
        current,
        callback: async (path) => {
          const style = game.settings.get("click-adventure", "orbStyle");
          await game.settings.set("click-adventure", "orbStyle", { ...style, orbImage: path });
          this.render({ force: true });
          this._refreshHud();
        }
      }).browse();
    });

    // Image clear button
    html.querySelector(".ca-os-image-clear")?.addEventListener("click", async () => {
      const style = game.settings.get("click-adventure", "orbStyle");
      await game.settings.set("click-adventure", "orbStyle", { ...style, orbImage: "" });
      this.render({ force: true });
      this._refreshHud();
    });
  }

  /** Forces a HUD re-render if active. */
  _refreshHud() {
    if (globalThis.ClickAdventure._hud?.rendered) {
      globalThis.ClickAdventure._hud.render({ force: true });
    }
  }
}
