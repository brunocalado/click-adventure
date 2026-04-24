/**
 * TileAdventureSheet
 * Extends DocumentSheetV2 to inject a Click Adventure tab into the Tile configuration sheet.
 * Triggered by: AppV2 render pipeline via _prepareContext / _preparePartContext
 */
export class TileAdventureSheet extends foundry.applications.api.DocumentSheetV2 {
  /** @override */
  static DEFAULT_OPTIONS = {
    id: "click-adventure-tile-sheet",
    classes: ["click-adventure", "tile-sheet"],
    window: {
      title: "Click Adventure - Tile Settings"
    },
    position: {
      width: 480
    },
    form: {
      submitOnChange: false,
      closeOnSubmit: true
    }
  };

  /** @override */
  static BASE_APPLICATION = foundry.applications.api.DocumentSheetV2;

  /** @override */
  static PARTS = {
    tabs: {
      template: "templates/generic/tab-navigation.hbs"
    },
    adventure: {
      template: "modules/click-adventure/templates/tile-adventure-tab.hbs"
    },
    footer: {
      template: "templates/generic/form-footer.hbs"
    }
  };

  /** @override */
  tabGroups = {
    sheet: "adventure"
  };

  /**
   * Prepare context data for all parts.
   * Called during AppV2 render pipeline.
   * @param {object} options - Render options
   * @returns {Promise<object>} Context object passed to Handlebars templates
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const targetSceneId = this.document.getFlag("click-adventure", "targetSceneId") ?? "";

    // Build scene list for the combobox, sorted alphabetically
    context.scenes = game.scenes
      .map(s => ({ id: s.id, name: s.name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    context.targetSceneId = targetSceneId;

    context.tabs = [
      {
        id: "adventure",
        group: "sheet",
        icon: "fa-solid fa-map",
        label: "Adventure"
      }
    ];

    context.buttons = [
      { type: "submit", icon: "fa-solid fa-floppy-disk", label: "Save" }
    ];

    return context;
  }

  /**
   * Inject part-specific context for the adventure tab.
   * Called by AppV2 per-part render pipeline.
   * @param {string} partId - The PARTS key being rendered
   * @param {object} context - Shared context from _prepareContext
   * @param {object} options - Render options
   * @returns {Promise<object>} Part-specific context
   */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (partId === "adventure") {
      context.tab = context.tabs.find(t => t.id === "adventure");
    }
    return context;
  }

  /**
   * Handle form submission to save the target scene flag on the Tile document.
   * @param {Event} event - The submit event
   * @param {HTMLFormElement} form - The form element
   * @param {FormDataExtended} formData - Parsed form data
   */
  async _processSubmitData(event, form, formData) {
    const targetSceneId = formData.object["click-adventure.targetSceneId"] ?? "";
    await this.document.setFlag("click-adventure", "targetSceneId", targetSceneId);
  }
}
