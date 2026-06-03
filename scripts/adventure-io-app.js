/**
 * AdventureIOApp — Export and import adventure groups (graphs) as JSON.
 *
 * Export: serialises selected graphs from the world setting to a downloadable
 * JSON file. Scene IDs are stripped; macro references carry name metadata so
 * the import side can resolve them by name as a fallback.
 *
 * Import: reads a previously exported JSON file, resolves macro references
 * (UUID first, then world-macro name), resolves linked-scene references by
 * scene name, creates Foundry Scenes for every node, and appends the imported
 * graphs to the world collection.
 *
 * Accessible via game.settings.registerMenu → Foundry module settings panel.
 * Restricted to GM users.
 *
 * Lifecycle hook: renderAdventureIOApp
 */

import { MODULE_ID } from "./constants.js";
import { getOrCreateFolder, createSceneForNode } from "./manager-scene-ops.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class AdventureIOApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "adventure-io-app",
    classes: ["click-adventure", "adventure-io"],
    window: { title: "Export / Import Adventure" },
    position: { width: 480, height: "auto" }
  };

  /** @override */
  static PARTS = {
    main: { template: "modules/click-adventure/templates/adventure-io-app.hbs" }
  };

  constructor(options = {}) {
    super(options);
    /**
     * Parsed JSON payload from a loaded import file.
     * @type {{ clickAdventureVersion: string, graphs: object[] }|null}
     */
    this._importData = null;
    /** @type {string} Display name of the loaded file. */
    this._importFileName = "";
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Provides the current graph list for export and, when a file is loaded,
   * the candidate graphs for import.
   *
   * @override
   * @param {object} options
   * @returns {Promise<object>}
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);

    const col = game.settings.get(MODULE_ID, "graphs");
    const raw = typeof col?.toObject === "function" ? col.toObject() : (col ?? {});
    context.graphs = (raw.graphs ?? []).map(g => ({
      id:        g.id,
      name:      g.name,
      nodeCount: (g.nodes ?? []).length,
      linkCount: (g.links ?? []).length
    }));

    if (this._importData) {
      context.importGraphs = (this._importData.graphs ?? []).map((g, i) => ({
        index:     i,
        name:      g.name,
        nodeCount: (g.nodes ?? []).length,
        linkCount: (g.links ?? []).length
      }));
      context.importFileName = this._importFileName;
    }

    return context;
  }

  /**
   * Wires all interactive elements after every render.
   * Called from the ApplicationV2 _onRender lifecycle stage.
   *
   * @override
   * @param {object} context
   * @param {object} options
   */
  _onRender(context, options) {
    super._onRender(context, options);
    const html = this.element;

    // ── Export panel ────────────────────────────────────────────────────────
    html.querySelector("[data-action='export-select-all']")?.addEventListener("click", () => {
      html.querySelectorAll(".ca-io-export-check").forEach(cb => { cb.checked = true; });
    });

    html.querySelector("[data-action='export-deselect-all']")?.addEventListener("click", () => {
      html.querySelectorAll(".ca-io-export-check").forEach(cb => { cb.checked = false; });
    });

    html.querySelector("[data-action='export']")?.addEventListener("click", () => {
      const selected = new Set(
        [...html.querySelectorAll(".ca-io-export-check:checked")].map(cb => cb.dataset.graphId)
      );
      if (selected.size === 0) {
        ui.notifications.warn("Click Adventure: Select at least one group to export.");
        return;
      }
      this._doExport(selected);
    });

    // ── Import panel ─────────────────────────────────────────────────────────
    html.querySelector(".ca-io-file-input")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data.clickAdventureVersion || !Array.isArray(data.graphs)) {
          ui.notifications.error("Click Adventure: Invalid export file.");
          return;
        }
        this._importData     = data;
        this._importFileName = file.name;
        this.render({ force: true });
      } catch {
        ui.notifications.error("Click Adventure: Could not read file — is it valid JSON?");
      }
    });

    html.querySelector("[data-action='import-cancel']")?.addEventListener("click", () => {
      this._importData     = null;
      this._importFileName = "";
      this.render({ force: true });
    });

    html.querySelector("[data-action='import']")?.addEventListener("click", async () => {
      const indices = [...html.querySelectorAll(".ca-io-import-check:checked")]
        .map(cb => parseInt(cb.dataset.index, 10));
      if (indices.length === 0) {
        ui.notifications.warn("Click Adventure: Select at least one group to import.");
        return;
      }
      const selected = indices.map(i => this._importData.graphs[i]).filter(Boolean);
      await this._doImport(selected);
      this._importData     = null;
      this._importFileName = "";
      this.render({ force: true });
    });
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  /**
   * Builds the export payload, triggers a browser download, and notifies the GM.
   *
   * @param {Set<string>} selectedIds - graph IDs to include
   * @returns {void}
   */
  _doExport(selectedIds) {
    const col = game.settings.get(MODULE_ID, "graphs");
    const raw = typeof col?.toObject === "function" ? col.toObject() : (col ?? {});
    const selected = (raw.graphs ?? []).filter(g => selectedIds.has(g.id));

    const payload = {
      clickAdventureVersion: "1",
      exportDate:            new Date().toISOString(),
      graphs:                selected.map(g => this._serializeGraph(g))
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `click-adventure-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    ui.notifications.info(`Click Adventure: Exported ${selected.length} group(s).`);
  }

  /**
   * Serialises a graph entry for export.
   * - Strips sceneId from every node (scenes are recreated on import).
   * - Attaches macroName to every macro reference for name-based fallback resolution.
   * - Attaches sceneName to linked-scene entries for name-based lookup on import.
   * - Resets executedOnce flags so "once" macros fire again in the new world.
   *
   * @param {object} graph
   * @returns {object}
   */
  _serializeGraph(graph) {
    return {
      id:          graph.id,
      name:        graph.name,
      startNodeId: graph.startNodeId ?? "",
      nodes:       (graph.nodes ?? []).map(n => this._serializeNode(n)),
      links:       (graph.links ?? []).map(l => ({ ...l }))
    };
  }

  /**
   * @param {object} node
   * @returns {object}
   */
  _serializeNode(node) {
    return {
      id:               node.id,
      label:            node.label ?? "Scene",
      images:           (node.images ?? []).map(img => ({
        ...img,
        macro: img.macro ? this._serializeMacroRef(img.macro) : null
      })),
      activeImageIndex: node.activeImageIndex ?? 0,
      x:                node.x ?? 0,
      y:                node.y ?? 0,
      sceneId:          null,
      linkedScenes:     (node.linkedScenes ?? []).map(ls => ({
        ...ls,
        sceneId:   null,
        sceneName: game.scenes.get(ls.sceneId)?.name ?? ls.label ?? null,
        macro:     ls.macro ? this._serializeMacroRef(ls.macro) : null
      })),
      nodeMacros:       (node.nodeMacros ?? []).map(nm => ({
        ...nm,
        executedOnce: false,
        macroName:    game.macros.get(nm.macroId)?.name ?? null
      })),
      autolockMode:     node.autolockMode ?? "inherit"
    };
  }

  /**
   * Enriches a macro reference with the current macro name.
   * @param {object} ref - { macroId, trigger, … }
   * @returns {object}
   */
  _serializeMacroRef(ref) {
    return {
      ...ref,
      macroName: game.macros.get(ref.macroId)?.name ?? ref.label ?? null
    };
  }

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  /**
   * Processes and persists selected graphs from the import payload.
   * For each graph:
   *   1. Resolves all macro references (UUID → world ID → name fallback).
   *   2. Resolves linked-scene references by scene name.
   *   3. Creates a Foundry Scene for every node (reusing the existing folder).
   *   4. Appends the graph to the world collection with a fresh ID.
   *
   * @param {object[]} graphs - graph objects from the import JSON
   * @returns {Promise<void>}
   */
  async _doImport(graphs) {
    ui.notifications.info("Click Adventure: Import started — creating scenes…");

    const folder   = await getOrCreateFolder();
    const warnings = [];

    const col = game.settings.get(MODULE_ID, "graphs");
    const raw = typeof col?.toObject === "function" ? col.toObject() : (col ?? {});
    let { activeGraphId }  = raw;
    const existingGraphs   = raw.graphs ?? [];
    const newGraphEntries  = [];

    for (const graph of graphs) {
      const newGraphId    = foundry.utils.randomID();
      const processedNodes = [];

      for (const node of (graph.nodes ?? [])) {
        const processed = await this._processNode(node, warnings);
        processedNodes.push(processed);
      }

      // Create Foundry Scenes immediately — no manual "Sync Scenes" step needed.
      for (let i = 0; i < processedNodes.length; i++) {
        const sceneId = await createSceneForNode(processedNodes[i], folder.id);
        processedNodes[i] = { ...processedNodes[i], sceneId };
      }

      newGraphEntries.push({
        id:          newGraphId,
        name:        graph.name,
        startNodeId: graph.startNodeId ?? "",
        nodes:       processedNodes,
        links:       graph.links ?? []
      });

      // Activate the first imported graph if the world has none yet.
      if (!activeGraphId) activeGraphId = newGraphId;
    }

    await game.settings.set(MODULE_ID, "graphs", {
      activeGraphId,
      graphs: [...existingGraphs, ...newGraphEntries]
    });

    if (warnings.length > 0) {
      ui.notifications.warn(
        `Click Adventure: Import complete with ${warnings.length} warning(s) — see browser console.`
      );
      warnings.forEach(w => console.warn(`Click Adventure | Import: ${w}`));
    } else {
      ui.notifications.info(
        `Click Adventure: Imported ${graphs.length} group(s) successfully.`
      );
    }

    const manager = foundry.applications.instances.get("manager-app");
    if (manager?.rendered) manager.render({ force: true });
  }

  /**
   * Resolves all external references (macros, linked scenes) within a node
   * and returns a clean copy ready for persistence.
   *
   * @param {object}   node     - raw node from the import JSON
   * @param {string[]} warnings - mutable array; push human-readable warnings here
   * @returns {Promise<object>}
   */
  async _processNode(node, warnings) {
    const images = [];
    for (const img of (node.images ?? [])) {
      let macro = null;
      if (img.macro) {
        const id = await this._resolveMacroId(
          img.macro.macroId, img.macro.macroName,
          warnings, `Node "${node.label}" / image "${img.label}"`
        );
        macro = id ? { ...img.macro, macroId: id } : null;
      }
      images.push({ ...img, macro });
    }

    const linkedScenes = [];
    for (const ls of (node.linkedScenes ?? [])) {
      const scene = ls.sceneName
        ? (game.scenes.find(s => s.name === ls.sceneName) ?? null)
        : null;
      if (ls.sceneName && !scene) {
        warnings.push(
          `Node "${node.label}": linked scene "${ls.sceneName}" not found — reference cleared.`
        );
      }
      let macro = null;
      if (ls.macro) {
        const id = await this._resolveMacroId(
          ls.macro.macroId, ls.macro.macroName,
          warnings, `Node "${node.label}" / linked scene "${ls.label}"`
        );
        macro = id ? { ...ls.macro, macroId: id } : null;
      }
      linkedScenes.push({ ...ls, sceneId: scene?.id ?? null, macro });
    }

    const nodeMacros = [];
    for (const nm of (node.nodeMacros ?? [])) {
      const id = await this._resolveMacroId(
        nm.macroId, nm.macroName,
        warnings, `Node "${node.label}" / node macro`
      );
      if (id) nodeMacros.push({ ...nm, macroId: id, executedOnce: false });
    }

    return { ...node, sceneId: null, images, linkedScenes, nodeMacros };
  }

  /**
   * Resolves a macro reference to a usable macroId in the current world.
   *
   * Resolution order:
   *   1. `fromUuid(macroId)` — works for compendium UUIDs (Compendium.module.macros.id)
   *   2. `game.macros.get(macroId)` — works when source and destination are the same world
   *   3. `game.macros.find(m => m.name === macroName)` — name-based fallback
   *
   * @param {string|null} macroId   - stored macro ID or UUID
   * @param {string|null} macroName - name of the macro, for fallback resolution
   * @param {string[]}    warnings  - mutable warnings array
   * @param {string}      context   - human-readable location for the warning message
   * @returns {Promise<string|null>} resolved macroId, or null if not found
   */
  async _resolveMacroId(macroId, macroName, warnings, context) {
    if (macroId) {
      // UUID path — covers compendium macros
      try {
        const doc = await fromUuid(macroId);
        if (doc) return macroId;
      } catch { /* not a valid UUID */ }

      // Same-world path — macroId matches directly
      if (game.macros.get(macroId)) return macroId;
    }

    // Name-based fallback
    if (macroName) {
      const macro = game.macros.find(m => m.name === macroName);
      if (macro) return macro.id;
    }

    if (macroId || macroName) {
      warnings.push(`${context}: macro "${macroName ?? macroId}" not found — reference cleared.`);
    }
    return null;
  }
}
