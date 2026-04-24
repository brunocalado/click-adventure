/**
 * injectAdventureTab
 * Injects a Click Adventure tab into the native TileConfig sheet.
 * Triggered by: renderTileConfig Hook (AppV2 lifecycle, fires after each render)
 *
 * Strategy: locate the tab navigation list and tab content area rendered by the
 * native sheet, then append our tab button and content panel using vanilla DOM.
 * Flags are read/written directly on the TileDocument.
 *
 * @param {foundry.applications.api.DocumentSheetV2} app - The TileConfig application instance
 * @param {HTMLElement} root - The rendered HTML root element
 */
export function injectAdventureTab(app, root) {
  const tileDoc = app.document;

  // Avoid double-injection if hook fires multiple times on same render
  if (root.querySelector(".click-adventure-tab-content")) return;

  // --- 1. Inject tab button into the nav ---
  const nav = root.querySelector(".tabs[data-group='sheet']");
  if (!nav) return;

  const tabButton = document.createElement("a");
  tabButton.classList.add("item");
  tabButton.dataset.tab = "click-adventure";
  tabButton.dataset.group = "sheet";
  tabButton.innerHTML = `<i class="fa-solid fa-map"></i> Adventure`;
  nav.appendChild(tabButton);

  // --- 2. Inject tab content panel ---
  const tabsContainer = root.querySelector(".tab[data-group='sheet']")?.parentElement;
  if (!tabsContainer) return;

  const targetSceneId = tileDoc.getFlag("click-adventure", "targetSceneId") ?? "";

  // Build scene options HTML
  const sceneOptions = game.scenes
    .map(s => ({ id: s.id, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(s => `<option value="${s.id}" ${s.id === targetSceneId ? "selected" : ""}>${s.name}</option>`)
    .join("");

  const panel = document.createElement("div");
  panel.classList.add("tab", "click-adventure-tab-content");
  panel.dataset.tab = "click-adventure";
  panel.dataset.group = "sheet";
  panel.innerHTML = `
    <div class="form-group">
      <label>Navigate to Scene</label>
      <div class="form-fields">
        <select class="click-adventure-scene-select">
          <option value="">&mdash; No navigation &mdash;</option>
          ${sceneOptions}
        </select>
      </div>
      <p class="hint">When a player clicks this tile, they will be taken to the selected scene. Leave empty to disable navigation.</p>
    </div>
  `;

  tabsContainer.appendChild(panel);

  // --- 3. Save flag when the select changes ---
  panel.querySelector(".click-adventure-scene-select").addEventListener("change", async (event) => {
    await tileDoc.setFlag("click-adventure", "targetSceneId", event.target.value);
  });

  // The native Tabs controller on TileConfig will pick up our new tab/button
  // automatically because we reused the existing data-group and data-tab values.
}
