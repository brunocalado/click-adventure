/*!
 * Click Adventure
 * 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * Camera flight over an overview map, played as a DOM overlay above everything but notifications.
 *
 * Driven by Web Animations on `transform`/`opacity` only, so the compositor keeps it moving while
 * `canvas.draw()` loads the next scene on the main thread. A requestAnimationFrame loop (what the
 * approved mockup used) stutters there, and the mockup's per-frame `blur()` on the whole map was
 * the costliest part of it, so the blur is gone.
 *
 * A framing is what the camera shows, in map units (the map image's pixel space as the overview
 * scene sizes it).
 * @typedef {{kind: "room", points: number[], label?: string}} RoomFraming  flat [x0,y0,x1,y1,…]
 * @typedef {{kind: "map"}} MapFraming                                       whole map fitted
 * @typedef {{kind: "view", x: number, y: number, scale: number}} ViewFraming centre + scale
 */

import { MODULE_ID } from "./constants.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// The approved mockup's timings. Fixed on purpose: there are no knobs.
const FADE_MS = 450;
const FLY_MS = 2200;
const HOLD_MS = 650;
const HOLD_SKIPPED_MS = 150;
const PULL = 0.45;

/**
 * Decoded map images by src. The element itself is reused by every flight (only one overlay is
 * ever mounted), so a map is fetched and decoded once per session.
 * @type {Map<string, HTMLImageElement>}
 */
const images = new Map();

/** The overlay currently mounted, if any. */
let mounted = null;

/** Scale that fits the whole map with a small margin. */
export function mapScale(width, height) {
  return 0.92 * Math.min(innerWidth / width, innerHeight / height);
}

const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const lerp = (a, b, t) => a + (b - a) * t;
const wait = ms => new Promise(r => setTimeout(r, ms));

function cameraTransform(x, y, s) {
  return `translate(${innerWidth / 2 - x * s}px, ${innerHeight / 2 - y * s}px) scale(${s})`;
}

export class FlightOverlay {
  #map;
  #root = null;
  #world = null;
  #caption = null;
  #from = null;
  #to = null;
  #camera = null;
  #animation = null;
  #skipped = false;
  #destroyed = false;
  #abort;
  #aborted = new Promise(r => { this.#abort = r; });

  /** @param {{src: string, width: number, height: number}} map  width/height in map units */
  constructor(map) {
    this.#map = map;
  }

  /** Preload and decode the map image once per src. */
  async ready() {
    const { src } = this.#map;
    if (images.has(src)) return;
    const img = new Image();
    img.src = src;
    await img.decode();
    images.set(src, img);
  }

  /**
   * Mount the overlay framed on `from` and fade it in. Outlines: `to` gets the destination style,
   * `from` (when a room) the dashed origin style. Any overlay already mounted is destroyed first,
   * so only one ever exists.
   * @param {RoomFraming|MapFraming|ViewFraming} from
   * @param {RoomFraming|MapFraming} to
   */
  async cover(from, to) {
    mounted?.destroy();
    mounted = this;
    this.#from = this.#resolve(from);
    this.#to = this.#resolve(to);
    this.#mount(from, to);
    this.#setCamera(this.#from);
    // Force a style flush so the bars' transition runs from their collapsed state.
    void this.#root.offsetWidth;
    this.#root.classList.add("ca-flight--on");
    const fade = this.#root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease", fill: "forwards" });
    await this.#race(fade.finished);
  }

  /** Fly to `to`; resolves when the camera has landed. A click on the overlay skips to the end. */
  async fly() {
    if (this.#destroyed) return;
    const A = this.#from, B = this.#to;
    const { width: W, height: H } = this.#map;
    const dist = Math.hypot(B.x - A.x, B.y - A.y);
    // The mockup's 1400 px reference distance belongs to a 2002×3150 map; scaled by the diagonal so
    // other maps dip the same proportion. Never past the map framing, which would expose the paper.
    const sMid = Math.max(mapScale(W, H),
      Math.min(A.s, B.s) * (1 - PULL * Math.min(1, dist / (0.375 * Math.hypot(W, H)))));

    // Sampled once and played by the compositor: position eases A→B, zoom dips toward sMid by
    // sin(π·e). Linear easing between 60 samples reproduces the curve.
    const frames = Array.from({ length: 61 }, (_, i) => {
      const e = easeInOutCubic(i / 60);
      const base = lerp(A.s, B.s, e);
      const s = base - (base - sMid) * Math.sin(Math.PI * e);
      return { transform: cameraTransform(lerp(A.x, B.x, e), lerp(A.y, B.y, e), s) };
    });
    this.#animation = this.#world.animate(frames, { duration: FLY_MS, easing: "linear", fill: "forwards" });
    if (this.#skipped) this.#animation.finish();
    await this.#race(this.#animation.finished.catch(() => {}));
    this.#camera = B;
  }

  /**
   * Glide from where the camera is to `view` with no dip. Used on landing over the overview
   * scene, so the overlay ends on exactly what the real canvas shows before it dissolves.
   * @param {ViewFraming} view
   * @param {number} duration  ms
   */
  async settle(view, duration) {
    if (this.#destroyed || !this.#camera) return;
    const A = this.#camera, B = this.#resolve(view);
    this.#animation = this.#world.animate([
      { transform: cameraTransform(A.x, A.y, A.s) },
      { transform: cameraTransform(B.x, B.y, B.s) }
    ], { duration, easing: "ease-out", fill: "forwards" });
    await this.#race(this.#animation.finished.catch(() => {}));
    this.#camera = B;
  }

  /**
   * Show `caption`, hold at least 650 ms (150 ms after a skip) and until `until` settles, then
   * fade out and unmount. `until` is how navigation holds on the destination while it loads.
   * @param {{caption?: string, until?: Promise<unknown>}} [options]
   */
  async land({ caption, until } = {}) {
    if (this.#destroyed) return;
    if (caption) {
      this.#caption.textContent = caption;
      this.#caption.classList.add("ca-flight-caption--on");
    }
    await this.#race(Promise.all([
      wait(this.#skipped ? HOLD_SKIPPED_MS : HOLD_MS),
      Promise.resolve(until).catch(() => {})
    ]));
    if (this.#destroyed) return;
    this.#caption.classList.remove("ca-flight-caption--on");
    const fade = this.#root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: "ease", fill: "forwards" });
    await this.#race(fade.finished);
    this.destroy();
  }

  /**
   * Unmount immediately, with no fade, and resolve any pending fly()/land() so a caller awaiting
   * them never hangs (error paths, and a new flight replacing this one).
   */
  destroy() {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#animation?.cancel();
    this.#root?.remove();
    if (mounted === this) mounted = null;
    this.#abort();
  }

  /** Resolves `promise`, or early when the overlay is destroyed. */
  #race(promise) {
    return Promise.race([promise, this.#aborted]);
  }

  /** A framing as a camera: centre (x, y) and scale s. */
  #resolve(framing) {
    const { width: W, height: H } = this.#map;
    const fit = mapScale(W, H);
    if (framing.kind === "view") return { x: framing.x, y: framing.y, s: framing.scale };
    if (framing.kind === "room") {
      const pts = framing.points;
      const xs = [], ys = [];
      for (let i = 0; i < pts.length; i += 2) { xs.push(pts[i]); ys.push(pts[i + 1]); }
      const w = Math.max(...xs) - Math.min(...xs);
      const h = Math.max(...ys) - Math.min(...ys);
      // The mockup's frameScale, floored at the map framing so a large room never zooms out past it.
      const s = Math.max(fit, Math.min(innerWidth / (w * 2.4), innerHeight / (h * 2.4), 2.2));
      return { x: xs.reduce((a, b) => a + b) / xs.length, y: ys.reduce((a, b) => a + b) / ys.length, s };
    }
    return { x: W / 2, y: H / 2, s: fit };
  }

  #setCamera({ x, y, s }) {
    this.#world.style.transform = cameraTransform(x, y, s);
    this.#camera = { x, y, s };
  }

  #mount(from, to) {
    const { src, width: W, height: H } = this.#map;
    const root = document.createElement("div");
    root.className = `${MODULE_ID} ca-flight`;
    root.innerHTML = `
      <div class="ca-flight-world"></div>
      <div class="ca-flight-fog"></div>
      <svg class="ca-flight-grain" width="100%" height="100%">
        <filter id="ca-flight-noise"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/></filter>
        <rect width="120%" height="120%" filter="url(#ca-flight-noise)"/>
      </svg>
      <div class="ca-flight-vignette"></div>
      <div class="ca-flight-bar ca-flight-bar--top"></div>
      <div class="ca-flight-bar ca-flight-bar--bottom"></div>
      <div class="ca-flight-caption"></div>`;

    const world = root.querySelector(".ca-flight-world");
    const img = images.get(src) ?? Object.assign(new Image(), { src });
    img.className = "ca-flight-map";
    img.alt = "";
    img.style.width = `${W}px`;
    img.style.height = `${H}px`;
    world.append(img);

    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    if (from.kind === "room") svg.append(this.#polygon(from.points, "ca-flight-room--origin"));
    if (to.kind === "room") svg.append(this.#polygon(to.points, "ca-flight-room--dest"));
    world.append(svg);

    root.addEventListener("click", () => this.#skip());
    document.body.append(root);
    this.#root = root;
    this.#world = world;
    this.#caption = root.querySelector(".ca-flight-caption");
  }

  #polygon(points, cls) {
    const pg = document.createElementNS(SVG_NS, "polygon");
    const pairs = [];
    for (let i = 0; i < points.length; i += 2) pairs.push(`${points[i]},${points[i + 1]}`);
    pg.setAttribute("points", pairs.join(" "));
    pg.setAttribute("class", `ca-flight-room ${cls}`);
    return pg;
  }

  #skip() {
    this.#skipped = true;
    this.#animation?.finish();
  }
}
