/**
 * injectAdventureTab
 * Injects a Click Adventure tab into the native TileConfig sheet (AppV2).
 *
 * The v14 TileConfig renders tabs via the generic tab-navigation template under
 * tab group "sheet". AppV2 wires tab activation through event delegation on
 * elements carrying data-action="tab", so new buttons must carry that attribute
 * to participate in the native tab controller.
 *
 * Important: the renderTileConfig hook fires AFTER the AppV2 tab controller has
 * already run its initial activation pass. If the last active tab was
 * "click-adventure" (e.g. on a re-render triggered by setFlag), the controller
 * found nothing and fell back silently. We therefore apply the active state
 * manually after injection when needed.
 *
 * @param {foundry.applications.api.DocumentSheetV2} app - The TileConfig application
 * @param {HTMLElement} root - The rendered HTML root element
 */
export function injectAdventureTab(app, root) {
  const tileDoc = app.document;

  if (root.querySelector('[data-tab="click-adventure"]')) return;

  const existingTabButton = root.querySelector('nav [data-action="tab"][data-tab]')
    ?? root.querySelector('nav [data-tab][data-group]');
  if (!existingTabButton) {
    console.warn("Click Adventure | Could not locate tab navigation in TileConfig");
    return;
  }

  const nav = existingTabButton.parentElement;
  const tabGroup = existingTabButton.dataset.group ?? "sheet";

  // --- Tab button ---
  const tabButton = document.createElement(existingTabButton.tagName.toLowerCase());
  for (const cls of existingTabButton.classList) {
    if (cls !== "active") tabButton.classList.add(cls);
  }
  tabButton.dataset.action = "tab";
  tabButton.dataset.group = tabGroup;
  tabButton.dataset.tab = "click-adventure";
  tabButton.innerHTML = `<i class="fa-solid fa-map"></i> Adventure`;
  nav.appendChild(tabButton);

  // --- Tab content panel ---
  const existingPanel = root.querySelector(`.tab[data-group="${tabGroup}"]`)
    ?? root.querySelector('section.tab[data-tab]')
    ?? root.querySelector('div.tab[data-tab]');
  if (!existingPanel) {
    console.warn("Click Adventure | Could not locate tab content container in TileConfig");
    return;
  }

  const panelParent = existingPanel.parentElement;
  const sibling = panelParent.querySelector(`.tab[data-group="${tabGroup}"]:last-of-type`)
    ?? existingPanel;

  const targetSceneId = tileDoc.getFlag("click-adventure", "targetSceneId") ?? "";

  const sceneOptions = game.scenes
    .map(s => ({ id: s.id, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(s => `<option value="${s.id}" ${s.id === targetSceneId ? "selected" : ""}>${s.name}</option>`)
    .join("");

  const panel = document.createElement(existingPanel.tagName.toLowerCase());
  panel.classList.add("tab", "click-adventure-tab-content");
  panel.dataset.group = tabGroup;
  panel.dataset.tab = "click-adventure";
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

  sibling.after(panel);

  // If "click-adventure" is (or should be) the current tab, the native tab
  // controller has already run without finding our elements. Apply active state
  // manually so the panel is visible immediately without requiring a tab switch.
  const currentTab = app.tabGroups?.[tabGroup];
  if (currentTab === "click-adventure") {
    nav.querySelectorAll(`[data-group="${tabGroup}"][data-tab]`)
      .forEach(el => el.classList.toggle("active", el.dataset.tab === "click-adventure"));
    panelParent.querySelectorAll(`.tab[data-group="${tabGroup}"]`)
      .forEach(el => el.classList.toggle("active", el.dataset.tab === "click-adventure"));
  }

  panel.querySelector(".click-adventure-scene-select").addEventListener("change", async (event) => {
    await tileDoc.setFlag("click-adventure", "targetSceneId", event.target.value);
  });
}
