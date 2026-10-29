/**
 * AdventureIOApp — Export and import adventure groups (graphs) as JSON.
 *
 * Export: serialises selected graphs from the world setting to a downloadable
 * JSON file. Scene IDs are stripped, so nothing that lives on a Scene document
 * survives on its own — every cross-document reference (macro, linked scene,
 * journal page, playlist track) is written with name metadata alongside its id,
 * which is what lets the import side resolve it in a different world.
 *
 * Import: reads a previously exported JSON file, resolves those references
 * (id first, then name), creates Foundry Scenes for every node, and appends the
 * imported graphs to the world collection. Journal and music resolve into the
 * node's staging fields, which createSceneForNode bakes into the new Scene.
 *
 * Accessible via game.settings.registerMenu → Foundry module settings panel.
 * Restricted to GM users.
 *
 * Lifecycle hook: renderAdventureIOApp
 */

import { MODULE_ID } from "./constants.js";
import { importGraphs } from "./adventure-import.js";
import { getNodeJournal, getNodeMusic } from "./node-media.js";
import { getOverviewScene, getOverviewMap, regionPoints, resolveNodeRegion } from "./flight-data.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Every adventure file declared by an active module under flags["click-adventure"].adventures in
 * its manifest. A manifest flag needs no code in the content module and no load-order care.
 * @returns {{module: Module, path: string}[]}
 */
function declaredAdventureFiles() {
  return game.modules.filter(m => m.active).flatMap(m => {
    const list = m.flags?.[MODULE_ID]?.adventures;
    return (Array.isArray(list) ? list : [])
      .filter(p => typeof p === "string" && p)
      .map(path => ({ module: m, path }));
  });
}

export class AdventureIOApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "adventure-io-app",
    classes: ["click-adventure", "adventure-io"],
    window: { title: "Export / Import Adventure" },
    position: { width: 560, height: "auto" }
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
    /**
     * Adventure files declared by modules, fetched once per window and kept until Refresh.
     * @type {Map<string, Promise<{graphs?: object[], error?: string}>>}
     */
    this._moduleFiles = new Map();
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

    const existingIds = new Set(context.graphs.map(g => g.id));
    context.moduleAdventures = [];
    for (const { module, path } of declaredAdventureFiles()) {
      const { graphs, error } = await this._loadModuleFile(path);
      const base = { moduleTitle: module.title, path };
      if (error) {
        context.moduleAdventures.push({ ...base, index: -1, name: path, error });
        continue;
      }
      graphs.forEach((g, index) => {
        const hasId = typeof g?.id === "string" && g.id !== "";
        context.moduleAdventures.push({
          ...base, index,
          name:      g?.name ?? path,
          nodeCount: (g?.nodes ?? []).length,
          linkCount: (g?.links ?? []).length,
          imported:  hasId && existingIds.has(g.id),
          error:     hasId ? null : "group has no id"
        });
      });
    }

    return context;
  }

  /**
   * Fetches a module-declared adventure file, once per window instance.
   * @param {string} path  a Data path, resolved like every image path inside the file
   * @returns {Promise<{graphs?: object[], error?: string}>}
   */
  _loadModuleFile(path) {
    if (!this._moduleFiles.has(path)) {
      this._moduleFiles.set(path, foundry.utils.fetchJsonWithTimeout(path, {}, { timeoutMs: 10000 })
        .then(data => (data?.clickAdventureVersion && Array.isArray(data.graphs))
          ? { graphs: data.graphs }
          : { error: "not a Click Adventure file" })
        .catch(() => ({ error: "could not be loaded" })));
    }
    return this._moduleFiles.get(path);
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

    // ── From modules ─────────────────────────────────────────────────────────
    html.querySelector("[data-action='module-refresh']")?.addEventListener("click", () => {
      this._moduleFiles.clear();
      this.render({ force: true });
    });

    html.querySelectorAll("[data-action='module-import'], [data-action='module-reimport']").forEach(btn => {
      btn.addEventListener("click", async () => {
        const { path, index } = btn.dataset;
        const { graphs } = await this._loadModuleFile(path);
        const graph = graphs?.[parseInt(index, 10)];
        if (!graph) return;
        if (btn.dataset.action === "module-reimport" && !(await this._confirmReimport(graph, btn.dataset.moduleTitle))) return;
        btn.disabled = true;
        await importGraphs([foundry.utils.deepClone(graph)], { keepIds: true });
        this.render({ force: true });
      });
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
      await importGraphs(selected);
      this._importData     = null;
      this._importFileName = "";
      this.render({ force: true });
    });
  }

  /**
   * Asks before a module adventure replaces the group already in the world.
   * @param {object} graph
   * @param {string} moduleTitle
   * @returns {Promise<boolean>}
   */
  async _confirmReimport(graph, moduleTitle) {
    const { escapeHTML } = foundry.utils;
    const col = game.settings.get(MODULE_ID, "graphs");
    const raw = typeof col?.toObject === "function" ? col.toObject() : (col ?? {});
    const isActive = raw.activeGraphId === graph.id;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: "Reimport Adventure" },
      classes: ["click-adventure", "ca-dialog"],
      content: `<p>Replace <strong>${escapeHTML(graph.name ?? "")}</strong> with the version shipped by
        <strong>${escapeHTML(moduleTitle ?? "")}</strong>?</p>
        <p>Every change made to this group in this world is lost: nodes, links, images, macros,
        positions and overview rooms. Its scenes are deleted and created again.</p>`
        // A deleted scene leaves whoever was viewing it on an empty canvas; nothing throws.
        + (isActive ? "<p>This is the active group. Players viewing its scenes will see an empty canvas until you move them again.</p>" : ""),
      yes: { label: "Reimport", class: "ca-btn ca-btn--danger" },
      no:  { label: "Cancel", class: "ca-btn ca-btn--quiet" },
      rejectClose: false
    });
    return confirmed === true;
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

    const filename = `click-adventure-export-${Date.now()}.json`;
    const file     = new File([JSON.stringify(payload, null, 2)], filename, { type: "text/plain" });
    const url      = URL.createObjectURL(file);
    const a        = document.createElement("a");
    a.href         = url;
    a.download     = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    // bubbles:false prevents Foundry's document-level click handlers from intercepting.
    a.dispatchEvent(new MouseEvent("click", { bubbles: false, cancelable: true }));
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);

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
      links:       (graph.links ?? []).map(l => ({ ...l })),
      flight:      this._serializeFlight(graph)
    };
  }

  /**
   * The overview lives on a Scene, which export strips like every node scene, so it is written as
   * data: the map, its size in map units, and every Region on it in the same shape
   * Flight.apply() accepts. A room's `node` is the linked node's label, because ids mean nothing in
   * another world — which is also why a node's `flightRegionId` is not exported.
   *
   * @param {object} graph
   * @returns {object|null}
   */
  _serializeFlight(graph) {
    const overview = getOverviewScene(graph);
    if (!overview) return null;
    const map = getOverviewMap(overview);
    const toPairs = flat => Array.from({ length: flat.length / 2 }, (_, i) => [flat[2 * i], flat[2 * i + 1]]);
    return {
      enabled: graph.flight?.enabled === true,
      pace: graph.flight?.pace ?? "normal",
      sound: graph.flight?.sound ?? null,
      map: map.src,
      size: { width: map.width, height: map.height },
      rooms: [...overview.regions].map(region => ({
        name: region.name,
        node: (graph.nodes ?? []).find(n => resolveNodeRegion(n, overview)?.id === region.id)?.label ?? null,
        points: toPairs(regionPoints(overview, region))
      }))
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
      autolockMode:     node.autolockMode ?? "inherit",
      isCameraRoom:     node.isCameraRoom ?? false,
      cameraLabel:      node.cameraLabel ?? "",
      journalTrigger:   node.journalTrigger ?? "view",
      journal:          this._serializeJournalRef(node),
      music:            this._serializeMusicRef(node)
    };
  }

  /**
   * Serialises the node's journal assignment. It normally lives on the node's Scene,
   * which export strips, so it is written out as an id + name pair — the id is what
   * makes a re-import into the same world exact, the name is what makes it work at all
   * in a different one.
   *
   * @param {object} node
   * @returns {{journalId: string, journalName: string, pageId: string|null, pageName: string|null}|null}
   */
  _serializeJournalRef(node) {
    const { journal, page } = getNodeJournal(node);
    if (!journal) return null;
    return {
      journalId:   journal.id,
      journalName: journal.name,
      pageId:      page?.id   ?? null,
      pageName:    page?.name ?? null
    };
  }

  /**
   * Serialises the node's music assignment, same reasoning as the journal above.
   * A null sound means the whole playlist was assigned, which Foundry honours by
   * following the playlist's own mode.
   *
   * @param {object} node
   * @returns {{playlistId: string, playlistName: string, soundId: string|null, soundName: string|null}|null}
   */
  _serializeMusicRef(node) {
    const { playlist, sound } = getNodeMusic(node);
    if (!playlist) return null;
    return {
      playlistId:   playlist.id,
      playlistName: playlist.name,
      soundId:      sound?.id   ?? null,
      soundName:    sound?.name ?? null
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
}
