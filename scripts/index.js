/**
 * Click Adventure — module entry point.
 * All scripts are imported here so module.json only needs a single esmodules entry.
 * Import order: data models and utilities first, then applications, then main init.
 */

export { AdventureDataModel } from "./adventure-data-model.js";
export { buildSceneData }     from "./scene-template.js";
export { ManagerApp }         from "./manager-app.js";
export { NodeConfigApp }      from "./node-config-app.js";
export { NavHudApp }          from "./nav-hud-app.js";

// Main init — must be last because it references all the above
import "./click-adventure.js";
