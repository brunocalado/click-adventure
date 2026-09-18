/**
 * Editor sheet for the passages array of a link.
 *
 * Each passage carries an independent direction and state — see the model comment in
 * node-utils.js. A link with exactly one passage behaves identically to the legacy
 * single-passage link. A link with 2+ passages is "multi-passage" — clicking it in the
 * Manager opens this sheet instead of cycling. Shift+click opens this sheet regardless
 * of passage count.
 *
 * Opened from ManagerApp._renderLinks via Shift+click or auto-open for multi-passage links.
 * Lifecycle hook: renderLinkEditorApp
 */

import { getFirstPassage, getGraphData, saveGraphData, cyclePassageDirection, cyclePassageState, decomposeDirection } from "./node-utils.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Turns a dropped document into a key condition for a custom-state passage.
 *
 * An item records `sourceUuid` — the compendium the item came from, when it has one — so
 * the check can match a player's own copy rather than the id of the dragged document,
 * which never survives being embedded in an actor (see _evaluateKeyCondition).
 *
 * A macro dropped from a compendium is imported into the world first, because
 * macro.execute() needs a world document. Items, actors and scenes are only ever looked
 * up, never executed, so a compendium source is left alone.
 *
 * @param {DragEvent} event
 * @returns {Promise<object|null>} the key, or null when the drop was not a supported type
 */
async function _resolveKeyFromDrop(event) {
  let data;
  try { data = JSON.parse(event.dataTransfer.getData("text/plain")); }
  catch { return null; }
  if (!data?.uuid) return null;

  const doc = await foundry.utils.fromUuid(data.uuid);
  if (!doc) return null;

  switch (data.type) {
    case "Item":
      return {
        type: "item",
        sourceUuid: doc._stats?.compendiumSource ?? (doc.pack ? doc.uuid : null),
        itemName: doc.name,
        label: doc.name
      };
    case "Actor":
      return { type: "actor", actorId: doc.id, label: doc.name };
    case "Scene":
      return { type: "scene", sceneId: doc.id, label: doc.name };
    case "Macro": {
      let macro = doc;
      if (macro.pack) {
        const pack = game.packs.get(macro.pack);
        if (!pack) return null;
        macro = game.macros.find(m => m.name === macro.name)
          ?? await game.macros.importFromCompendium(pack, macro.id);
      }
      return { type: "macro", macroId: macro.id, label: macro.name };
    }
    default:
      return null;
  }
}

export class LinkEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static BASE_APPLICATION = ApplicationV2;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "link-editor-app",
    classes: ["click-adventure", "link-editor"],
    window: { title: "Edit Link Passages", resizable: false },
    position: { width: 560, height: "auto" }
  };

  /** @override */
  static PARTS = {
    editor: { template: "modules/click-adventure/templates/link-editor-app.hbs" }
  };

  /**
   * @param {number} linkIndex — index into the graph.links array
   * @param {object} [options]
   */
  constructor(linkIndex, options = {}) {
    super(options);
    /** @type {number} */
    this._linkIndex = linkIndex;
    /**
     * Mutable working copy of passages — initialised from persisted data on first _prepareContext,
     * then updated in-memory until Save is clicked.  Mirrors NodeConfigApp's pending-state pattern.
     * @type {Array<{label: string, direction: string}>|null}
     */
    this._pendingPassages = null;
  }



  /**
   * Provides passage rows and endpoint labels to the editor template.
   * Pending passages are seeded from the persisted link only on the very first call so that
   * in-progress edits survive re-renders triggered by Add / Remove / direction-cycle.
   * Triggered during the ApplicationV2 _prepareContext lifecycle stage.
   *
   * @override
   * @param {object} options
   * @returns {Promise<object>}
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const { nodes, links } = getGraphData();
    const link = links[this._linkIndex];

    if (!link) {
      // Link was deleted while this sheet was open — close gracefully
      await this.close();
      return context;
    }

    if (!this._pendingPassages) {
      const stored = link.passages?.length ? link.passages : [getFirstPassage(link)];
      this._pendingPassages = structuredClone(stored);
    }

    const srcNode = nodes.find(n => n.id === link.sourceId);
    const tgtNode = nodes.find(n => n.id === link.targetId);
    context.fromLabel  = srcNode?.label || link.sourceId;
    context.toLabel    = tgtNode?.label || link.targetId;
    // Inject numeric index and per-passage display flags for the template. A passage read
    // from pre-0.3.0 data has no `state` yet; decomposing it here means the editor shows
    // what the passage actually does today, and saving writes it back in the two-axis form.
    context.passages = this._pendingPassages.map((p, i) => {
      const { dirAxis, stateAxis } = p.state !== undefined
        ? { dirAxis: p.direction ?? "both", stateAxis: p.state }
        : decomposeDirection(p.direction ?? "both");
      return {
        ...p,
        index: i,
        direction: dirAxis,
        state: stateAxis,
        displayModeIsPathOnly: (p.displayMode ?? "full") === "path-only",
        isCustom: stateAxis === "custom",
        keyMode: p.keyMode ?? "AND",
        lockedVisibility: p.lockedVisibility ?? "blocked",
        keys: (p.keys ?? []).map((k, ki) => ({ ...k, keyIndex: ki }))
      };
    });
    // True when the link is already promoted to multi-passage (either by forceMulti or 2+ passages)
    context.isMulti = link.forceMulti === true || (link.passages?.length ?? 0) > 1;
    return context;
  }

  /**
   * Wires all passage-row interactions after every render.
   * Triggered during the ApplicationV2 _onRender lifecycle stage.
   *
   * @override
   * @param {object} context
   * @param {object} options
   */
  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;

    html.querySelector(".ca-passage-add")?.addEventListener("click", () => {
      this._pendingPassages.push({ label: "", direction: "both", state: "open" });
      this.render({ force: true });
    });

    html.querySelectorAll(".ca-passage-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.closest("[data-index]").dataset.index, 10);
        this._pendingPassages.splice(i, 1);
        // Always keep at least one passage row
        if (this._pendingPassages.length === 0) {
          this._pendingPassages.push({ label: "", direction: "both", state: "open" });
        }
        this.render({ force: true });
      });
    });

    // Direction: both → forward → backward → both (per row, independent of state)
    html.querySelectorAll(".ca-passage-direction").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.closest("[data-index]").dataset.index, 10);
        this._patchPassage(i, p => ({ direction: cyclePassageDirection(p.direction) }));
      });
    });

    // State: open → blocked → secret → custom → open
    html.querySelectorAll(".ca-passage-state").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.closest("[data-index]").dataset.index, 10);
        this._patchPassage(i, p => ({ state: cyclePassageState(p.state) }));
      });
    });

    // ── Custom state: key drop zone, key removal, AND/OR, locked visibility ──
    html.querySelectorAll(".ca-passage-key-dropzone").forEach(zone => {
      zone.addEventListener("dragover", e => {
        e.preventDefault();
        zone.classList.add("ca-dropzone--over");
      });
      zone.addEventListener("dragleave", () => zone.classList.remove("ca-dropzone--over"));
      zone.addEventListener("drop", async e => {
        e.preventDefault();
        zone.classList.remove("ca-dropzone--over");
        const key = await _resolveKeyFromDrop(e);
        if (!key) {
          ui.notifications.warn("Click Adventure: Drop an Item, Actor, Macro, or Scene.");
          return;
        }
        const i = parseInt(zone.dataset.index, 10);
        this._patchPassage(i, p => ({ keys: [...(p.keys ?? []), key] }));
      });
    });

    html.querySelectorAll(".ca-passage-key-remove").forEach(btn => {
      btn.addEventListener("click", () => {
        const i  = parseInt(btn.dataset.index, 10);
        const ki = parseInt(btn.dataset.keyIndex, 10);
        this._patchPassage(i, p => ({ keys: (p.keys ?? []).filter((_, n) => n !== ki) }));
      });
    });

    html.querySelectorAll(".ca-passage-key-mode").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.index, 10);
        this._patchPassage(i, p => ({ keyMode: (p.keyMode ?? "AND") === "AND" ? "OR" : "AND" }));
      });
    });

    html.querySelectorAll(".ca-passage-locked-visibility").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.dataset.index, 10);
        this._patchPassage(i, p => ({
          lockedVisibility: (p.lockedVisibility ?? "blocked") === "blocked" ? "secret" : "blocked"
        }));
      });
    });

    // Label inputs update pending state live without triggering a re-render
    html.querySelectorAll(".ca-passage-label").forEach(input => {
      const i = parseInt(input.closest("[data-index]").dataset.index, 10);
      input.addEventListener("input", () => {
        // Enforce 100-char limit as a safeguard alongside the maxlength HTML attribute
        if (input.value.length > 100) input.value = input.value.slice(0, 100);
        this._pendingPassages[i] = { ...this._pendingPassages[i], label: input.value };
      });
    });

    html.querySelectorAll(".ca-display-mode-toggle").forEach(btn => {
      btn.addEventListener("click", () => {
        const i = parseInt(btn.closest("[data-index]").dataset.index, 10);
        const current = this._pendingPassages[i].displayMode ?? "full";
        this._pendingPassages[i] = { ...this._pendingPassages[i], displayMode: current === "path-only" ? "full" : "path-only" };
        this.render({ force: true });
      });
    });

    html.querySelector(".ca-link-editor-save")?.addEventListener("click", () => this._onSave());
    html.querySelector(".ca-convert-to-single")?.addEventListener("click", () => this._onConvertToSingle());
  }

  /**
   * Applies a patch to one pending passage and re-renders. The patch is built from the
   * current passage so a cycle can read its own previous value; direction and state are
   * normalised on the way in, because a passage loaded from pre-0.3.0 data has only the
   * legacy combined field until it is first touched here.
   *
   * @param {number} i
   * @param {(passage: object) => object} build
   */
  _patchPassage(i, build) {
    const current = this._pendingPassages[i];
    const { dirAxis, stateAxis } = current.state !== undefined
      ? { dirAxis: current.direction ?? "both", stateAxis: current.state }
      : decomposeDirection(current.direction ?? "both");
    const normalised = { ...current, direction: dirAxis, state: stateAxis };
    this._pendingPassages[i] = { ...normalised, ...build(normalised) };
    this.render({ force: true });
  }

  /**
   * Persists the pending passages array to the graph setting, sets forceMulti so the link
   * behaves as multi-passage even when only one passage remains, then refreshes all
   * open Click Adventure apps and closes this editor.
   * @returns {Promise<void>}
   */
  async _onSave() {
    const { nodes, links } = getGraphData();
    // Auto-fill any passage that was left without a name, and write direction/state
    // explicitly so a passage saved here is never left in the legacy combined form.
    const normalisedPassages = this._pendingPassages.map((p, i) => {
      const { dirAxis, stateAxis } = p.state !== undefined
        ? { dirAxis: p.direction ?? "both", stateAxis: p.state }
        : decomposeDirection(p.direction ?? "both");
      return {
        ...p,
        direction: dirAxis,
        state: stateAxis,
        label: (p.label ?? "").trim() || `Path ${i + 1}`
      };
    });
    const updatedLinks = links.map((l, i) =>
      i === this._linkIndex
        ? { ...l, passages: structuredClone(normalisedPassages), forceMulti: true }
        : l
    );
    await saveGraphData({ nodes, links: updatedLinks });

    const manager = foundry.applications.instances.get("manager-app");
    if (manager?.rendered) manager.render({ force: true });
    const hud = globalThis.ClickAdventure?._hud;
    if (hud?.rendered) hud.render({ force: true });

    this.close();
  }

  /**
   * Reverts the link to single-passage mode: keeps only the first passage and clears forceMulti.
   * Called when the user clicks "Convert to single" in the editor footer.
   * @returns {Promise<void>}
   */
  async _onConvertToSingle() {
    const { nodes, links } = getGraphData();
    const first = this._pendingPassages[0] ?? { label: "", direction: "both", state: "open" };
    const updatedLinks = links.map((l, i) =>
      i === this._linkIndex
        ? { ...l, passages: [{ ...first }], forceMulti: false }
        : l
    );
    await saveGraphData({ nodes, links: updatedLinks });

    const manager = foundry.applications.instances.get("manager-app");
    if (manager?.rendered) manager.render({ force: true });
    const hud = globalThis.ClickAdventure?._hud;
    if (hud?.rendered) hud.render({ force: true });

    this.close();
  }
}
