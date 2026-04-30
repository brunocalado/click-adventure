/**
 * OrbStyleApp — lets each player customise the visual style of their navigation HUD orb.
 * Opens from the gear settings popover. Saves to the per-client "orbStyle" setting.
 * Changes are applied to the live HUD immediately via a forced re-render.
 *
 * Lifecycle hook: renderOrbStyleApp
 */

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class OrbStyleApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static BASE_APPLICATION = ApplicationV2;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "orb-style-app",
    classes: ["click-adventure", "orb-style"],
    window: { frame: true, title: "HUD Orb Style", resizable: false },
    position: { width: 340, height: "auto" }
  };

  /** @override */
  static PARTS = {
    form: { template: "modules/click-adventure/templates/orb-style-app.hbs" }
  };

  /** @type {number|null} — rAF handle for the live preview goo animation */
  _previewRaf = null;

  /**
   * Provides current orbStyle values and derived helpers to the template.
   * @override
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const style = game.settings.get("click-adventure", "orbStyle");
    context.orbType  = style.type  ?? "orb";
    context.orbSize  = style.size  ?? 1;
    context.orbColor = style.color ?? "#3355aa";

    context.typeOptions = [
      { value: "orb",      label: "Orb"      },
      { value: "triangle", label: "Triangle" },
      { value: "goo",      label: "Goo Ball" }
    ];
    // Size steps shown to the user (label → slider value mapping)
    context.sizeOptions = [
      { value: 0.75, label: "Small"  },
      { value: 1,    label: "Normal" },
      { value: 1.5,  label: "Large"  },
      { value: 2,    label: "Huge"   },
      { value: 2.5,  label: "Giant"  }
    ];
    return context;
  }

  /**
   * Wires all controls so changes persist immediately and refresh the live HUD.
   * Also starts the goo preview animation when the goo type is active.
   * @override
   */
  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;

    // Type radio buttons
    html.querySelectorAll(".ca-os-type-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const style = game.settings.get("click-adventure", "orbStyle");
        await game.settings.set("click-adventure", "orbStyle", { ...style, type: btn.dataset.type });
        this.render({ force: true });          // re-render form so conditional sections update
        this._refreshHud();
      });
    });

    // Size slider
    const sizeInput = html.querySelector(".ca-os-size");
    if (sizeInput) {
      sizeInput.addEventListener("input", async (e) => {
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
        this._refreshHud();
      });
    }

    // Start goo preview animation when goo type is selected
    const previewCanvas = html.querySelector(".ca-os-goo-canvas");
    if (previewCanvas) {
      this._startGooPreview(previewCanvas, context.orbColor);
    } else {
      this._stopGooPreview();
    }
  }

  /** Stops the preview animation before closing. @override */
  async _onClose(options) {
    this._stopGooPreview();
    await super._onClose(options);
  }

  /** Forces a HUD re-render if active. */
  _refreshHud() {
    if (globalThis.ClickAdventure._hud?.rendered) {
      globalThis.ClickAdventure._hud.render({ force: true });
    }
  }

  /**
   * Starts the goo ball canvas animation inside the preview area.
   * Mirrors the logic in NavHudApp._startGooAnimation but smaller (120×180 canvas).
   * @param {HTMLCanvasElement} canvas
   * @param {string} color  — hex color string
   */
  _startGooPreview(canvas, color) {
    this._stopGooPreview();
    _runGooAnimation(canvas, color, 45, this, "_previewRaf");
  }

  _stopGooPreview() {
    if (this._previewRaf !== null) {
      cancelAnimationFrame(this._previewRaf);
      this._previewRaf = null;
    }
  }
}

/**
 * Runs the goo ball canvas animation on a given canvas element.
 * Stores the rAF handle on `owner[rafKey]` so callers can cancel it.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {string} color       — fill color (hex or rgba)
 * @param {number} ballRadius  — radius of the main ball in px
 * @param {object} owner       — object that owns the rAF handle property
 * @param {string} rafKey      — property name on `owner` where rAF handle is stored
 */
export function _runGooAnimation(canvas, color, ballRadius, owner, rafKey) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const mainBall = { x: W / 2, y: ballRadius + 10, angle: 0 };

  class Drip {
    constructor(x, y, r) {
      this.x = x; this.y = y; this.radius = r; this.maxR = r;
      this.vy = 0;
      this.gravity = Math.random() * 0.025 + 0.01;  // slower than original
      this.active = true;
    }
    update() {
      this.vy += this.gravity;
      this.y  += this.vy;
      if (this.vy > 1.5 && this.radius > this.maxR * 0.6) this.radius -= 0.04;
      if (this.y - this.radius > H) this.active = false;
    }
    draw() {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  let drips  = [];
  let frames = 0;

  function frame() {
    owner[rafKey] = requestAnimationFrame(frame);
    ctx.clearRect(0, 0, W, H);

    mainBall.angle += 0.02;   // slower than original 0.05
    const r = ballRadius + Math.sin(mainBall.angle) * 3;
    const y = mainBall.y + Math.cos(mainBall.angle) * 2;

    // Spawn drip every 80 frames (original was 40)
    if (frames % 80 === 0 && Math.random() > 0.3) {
      const ox     = (Math.random() - 0.5) * r * 1.2;
      const startY = y + r * 0.8;
      const dr     = Math.random() * (ballRadius * 0.25) + (ballRadius * 0.12);
      drips.push(new Drip(mainBall.x + ox, startY, dr));
    }

    // Drips
    for (let i = drips.length - 1; i >= 0; i--) {
      drips[i].update();
      drips[i].draw();
      if (!drips[i].active) drips.splice(i, 1);
    }

    // Main ball
    ctx.beginPath();
    ctx.arc(mainBall.x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    frames++;
  }

  owner[rafKey] = requestAnimationFrame(frame);
}
