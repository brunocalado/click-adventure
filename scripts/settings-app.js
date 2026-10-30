/**
 * Settings window for the Click Adventure module.
 * Opens on click of the gear button in the Manager toolbar.
 * Replaces the previous frameless outside-click popover.
 *
 * Lifecycle hook: renderSettingsApp
 */


import { onResetGraph } from "./manager-scene-ops.js";
import { getActiveGroup, saveGraphData } from "./node-utils.js";
import { getOverviewScene, getOverviewMap, getFlightRooms, createOverviewScene, changeOverviewMap, applyFlightData, setFlightOptions } from "./flight-data.js";
import { FlightOverlay } from "./flight-overlay.js";
import { paceMultiplier } from "./flight-travel.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class SettingsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @override */
  static BASE_APPLICATION = ApplicationV2;

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "settings-app",
    classes: ["click-adventure", "settings"],
    window: { title: "Click Adventure — Settings", resizable: false },
    position: { width: 560, height: "auto" }
  };

  /** @override */
  static PARTS = {
    panel: { template: "modules/click-adventure/templates/settings-app.hbs" }
  };

  /**
   * Id of the currently active tab. Held on the instance so the selected tab
   * survives re-renders (mirrors the pattern used by NodeConfigApp).
   * @type {string}
   */
  _activeTab = "scenes";

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

    // Per-group flag (stored on the active group object, not a game setting).
    // Absent field is treated as enabled to preserve existing groups' behavior.
    context.loadPlayerTokens = getActiveGroup()?.loadPlayerTokens !== false;

    context.useDefaultTokenPositions = game.settings.get("click-adventure", "useDefaultTokenPositions");
    context.showPlayerWhisper = game.settings.get("click-adventure", "showPlayerWhisper");
    context.playerDestinationPreview = game.settings.get("click-adventure", "playerDestinationPreview");
    context.journalAutoOpen = game.settings.get("click-adventure", "journalAutoOpen");

    // Flight over Map — per group, like loadPlayerTokens.
    const group = getActiveGroup();
    const overview = getOverviewScene(group);
    const rooms = group ? getFlightRooms(group) : { linked: [], unlinked: [], ambiguous: [] };
    // A missing or unknown pace reads as Normal, as it flies.
    const pace = ["slow", "fast"].includes(group?.flight?.pace) ? group.flight.pace : "normal";
    context.flight = {
      enabled: group?.flight?.enabled === true,
      overviewName: overview?.name ?? null,
      linkedCount: rooms.linked.length,
      nodeCount: group?.nodes?.length ?? 0,
      unlinked: rooms.unlinked.map(n => ({ id: n.id, label: n.label })),
      ambiguous: rooms.ambiguous.map(a => ({ label: a.node.label, regions: a.regions.map(r => r.name).join(", ") })),
      regionOptions: overview ? [...overview.regions].map(r => ({ id: r.id, name: r.name }))
        .sort((a, b) => a.name.localeCompare(b.name)) : [],
      sound: group?.flight?.sound ? {
        name: decodeURIComponent(group.flight.sound.src.split("/").pop()),
        volume: group.flight.sound.volume
      } : null,
      paces: [["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]].map(([value, label]) =>
        ({ value, label, active: pace === value })),
      caption: group?.flight?.caption !== false
    };

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

    // Tab switching — custom data-tab/data-panel pattern (no native TABS API),
    // matching NodeConfigApp. The active tab is restored on every render.
    const tabs   = this.element.querySelectorAll(".ca-settings-tab");
    const panels = this.element.querySelectorAll(".ca-settings-panel-tab");

    const activateTab = (tabName) => {
      tabs.forEach(t =>
        t.classList.toggle("ca-tab--active", t.dataset.tab === tabName)
      );
      panels.forEach(p =>
        p.classList.toggle("ca-settings-panel-tab--hidden", p.dataset.panel !== tabName)
      );
    };

    activateTab(this._activeTab);

    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        this._activeTab = tab.dataset.tab;
        activateTab(this._activeTab);
      });
    });

    this.element.querySelector(".ca-settings-transition")
      ?.addEventListener("change", async (e) => {
        await game.settings.set("click-adventure", "transitionType", e.target.value);
      });

    // Button groups bound to a world setting (HUD Visibility + Guide Mode). The Flight card's pace
    // group has no data-setting: it writes the group, in _wireFlightCard.
    this.element.querySelectorAll(".ca-btn-group[data-setting]").forEach(group => {
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

    // Sliding switches — generic handler for any boolean setting using data-setting
    this.element.querySelectorAll(".ca-switch[data-setting]").forEach(sw => {
      sw.addEventListener("click", async () => {
        const setting = sw.dataset.setting;
        const next    = !game.settings.get("click-adventure", setting);
        await game.settings.set("click-adventure", setting, next);
        sw.classList.toggle("ca-switch--on", next);
        sw.setAttribute("aria-checked", String(next));

        // Saved Positions only makes sense when tokens are loaded — enabling it
        // forces the per-group Load Player Tokens switch on.
        if (setting === "useDefaultTokenPositions" && next && getActiveGroup()?.loadPlayerTokens === false) {
          await saveGraphData({ loadPlayerTokens: true });
          const lpt = this.element.querySelector(".ca-load-player-tokens");
          lpt?.classList.add("ca-switch--on");
          lpt?.setAttribute("aria-checked", "true");
        }
      });
    });

    // Per-group "Load Player Tokens" switch — persists on the active group object
    // (not a game setting), so it cannot use the generic data-setting handler above.
    this.element.querySelector(".ca-load-player-tokens")
      ?.addEventListener("click", async function () {
        const next = getActiveGroup()?.loadPlayerTokens === false; // flip current state
        await saveGraphData({ loadPlayerTokens: next });
        this.classList.toggle("ca-switch--on", next);
        this.setAttribute("aria-checked", String(next));
      });

    this._wireFlightCard();

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

        // Auto-enable the switch if it was off
        const wasEnabled = game.settings.get("click-adventure", "useDefaultTokenPositions");
        if (!wasEnabled) {
          await game.settings.set("click-adventure", "useDefaultTokenPositions", true);
          const sw = this.element.querySelector('.ca-switch[data-setting="useDefaultTokenPositions"]');
          if (sw) {
            sw.classList.add("ca-switch--on");
            sw.setAttribute("aria-checked", "true");
          }
        }

        // Capturing positions implies token loading — force Load Player Tokens on.
        if (getActiveGroup()?.loadPlayerTokens === false) {
          await saveGraphData({ loadPlayerTokens: true });
          const lpt = this.element.querySelector(".ca-load-player-tokens");
          lpt?.classList.add("ca-switch--on");
          lpt?.setAttribute("aria-checked", "true");
        }

        ui.notifications.info(`Click Adventure: Saved default positions for ${count} player(s). Token placement enabled.`);
      });

    this.element.querySelector(".ca-reset-graph")
      ?.addEventListener("click", () => {
        const managerApp = globalThis.ClickAdventure?._manager;
        onResetGraph(managerApp ?? { render: () => {} });
      });
  }

  /**
   * Opens the image picker for the overview map. Nothing happens when the GM cancels, so turning
   * the switch on without picking a map leaves flight off.
   * @param {(path: string) => Promise<unknown>} onPick
   */
  _pickMapImage(onPick) {
    const FilePickerClass = foundry.applications.apps.FilePicker.implementation
      ?? foundry.applications.apps.FilePicker;
    new FilePickerClass({
      type: "image",
      current: "",
      callback: async (path) => {
        try {
          await onPick(path);
        } catch (err) {
          console.error("Click Adventure | Overview map:", err);
          ui.notifications.error(`Click Adventure: Could not load the map "${path}".`);
        }
        this.render();
      }
    }).render(true);
  }

  /**
   * Wires the Flight over Map card. Everything it changes lives on the active group, so the card
   * re-renders after each change rather than patching its own DOM.
   */
  _wireFlightCard() {
    const card = this.element.querySelector(".ca-flight-card");
    const group = getActiveGroup();
    if (!card || !group) return;
    const overview = getOverviewScene(group);

    card.querySelector(".ca-flight-enabled")?.addEventListener("click", async () => {
      const enabled = group.flight?.enabled === true;
      // The first switch-on asks for the map; creating the overview turns flight on.
      if (!enabled && !overview) return this._pickMapImage(path => createOverviewScene(group, path));
      await saveGraphData({ flight: { ...(group.flight ?? {}), enabled: !enabled } });
      this.render();
    });

    card.querySelector(".ca-flight-choose-map")?.addEventListener("click", () =>
      this._pickMapImage(path => createOverviewScene(group, path)));

    card.querySelector(".ca-flight-open")?.addEventListener("click", () => overview?.view());

    card.querySelector(".ca-flight-change-map")?.addEventListener("click", () =>
      this._pickMapImage(path => changeOverviewMap(group, path)));

    card.querySelectorAll(".ca-flight-region-select").forEach(select => {
      select.addEventListener("change", async () => {
        const nodes = (group.nodes ?? []).map(n =>
          n.id === select.dataset.nodeId ? { ...n, flightRegionId: select.value || null } : n);
        await saveGraphData({ nodes });
        this.render();
      });
    });

    card.querySelector(".ca-flight-preview")?.addEventListener("click", async () => {
      if (!overview) return;
      const overlay = new FlightOverlay(getOverviewMap(overview));
      await overlay.ready();
      await overlay.showcase(getFlightRooms(group).linked.map(r => ({ points: r.points, label: r.node.label })),
        { pace: paceMultiplier(group) });
    });

    card.querySelector(".ca-flight-sound-choose")?.addEventListener("click", () => {
      const FilePickerClass = foundry.applications.apps.FilePicker.implementation
        ?? foundry.applications.apps.FilePicker;
      new FilePickerClass({
        type: "audio",
        current: group.flight?.sound?.src ?? "",
        callback: async (src) => {
          await setFlightOptions(group.id, { sound: { src, volume: group.flight?.sound?.volume ?? 0.3 } });
          this.render();
        }
      }).render(true);
    });

    card.querySelector(".ca-flight-sound-clear")?.addEventListener("click", async () => {
      await setFlightOptions(group.id, { sound: null });
      this.render();
    });

    card.querySelector(".ca-flight-sound-volume")?.addEventListener("change", async (e) => {
      const sound = group.flight?.sound;
      if (!sound) return;
      await setFlightOptions(group.id, { sound: { ...sound, volume: Number(e.target.value) } });
      this.render();
    });

    card.querySelectorAll(".ca-flight-pace .ca-btn-group-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        await setFlightOptions(group.id, { pace: btn.dataset.value });
        this.render();
      });
    });

    card.querySelectorAll(".ca-flight-name .ca-btn-group-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        await setFlightOptions(group.id, { caption: btn.dataset.value === "on" });
        this.render();
      });
    });

    const fileInput = card.querySelector(".ca-flight-file-input");
    card.querySelector(".ca-flight-import")?.addEventListener("click", () => fileInput?.click());
    fileInput?.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (!file) return;
      let report;
      try {
        report = await applyFlightData(JSON.parse(await file.text()));
      } catch (err) {
        console.warn("Click Adventure | Room data import:", err);
        ui.notifications.error(`Click Adventure: Could not import "${file.name}". ${err.message}`);
        return;
      }
      ui.notifications.info(`Click Adventure: Created ${report.created.length}, updated ${report.updated.length}, linked ${report.linked.length}; ${report.unmatchedRooms.length} unmatched, see console.`);
      this.render();
    });
  }
}
