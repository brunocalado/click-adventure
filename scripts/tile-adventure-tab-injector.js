/**
 * injectAdventureTab
 * Injects a Click Adventure tab into the native TileConfig sheet (AppV2).
 *
 * The v14 TileConfig renders tabs via the generic tab-navigation template under
 * tab group "sheet". AppV2 wires tab activation through event delegation on
 * elements carrying data-action="tab", so new buttons must carry that attribute
 * to participate in the native tab controller.
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

  const tabButton = document.createElement(existingTabButton.tagName.toLowerCase());
  for (const cls of existingTabButton.classList) {
    if (cls !== "active") tabButton.classList.add(cls);
  }
  tabButton.dataset.action = "tab";
  tabButton.dataset.group = tabGroup;
  tabButton.dataset.tab = "click-adventure";
  tabButton.innerHTML = `<i class="fa-solid fa-map"></i> Adventure`;
  nav.appendChild(tabButton);

  const existingPanel = root.querySelector(`.tab[data-group="${tabGroup}"]`)
    ?? root.querySelector('section.tab[data-tab]')
    ?? root.querySelector('div.tab[data-tab]');
  if (!existingPanel) {
    console.warn("Click Adventure | Could not locate tab content container in TileConfig");
    return;
  }

  const panelParent = existingPanel.parentElement;

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

  panelParent.appendChild(panel);

  panel.querySelector(".click-adventure-scene-select").addEventListener("change", async (event) => {
    await tileDoc.setFlag("click-adventure", "targetSceneId", event.target.value);
  });
}
