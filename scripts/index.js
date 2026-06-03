/**
 * Click Adventure — module entry point.
 * All scripts are imported here so module.json only needs a single esmodules entry.
 * Import order: data models and utilities first, then applications, then main init.
 */

export { MODULE_ID }                  from "./constants.js";
export { AdventureDataModel }         from "./adventure-data-model.js";
export { AdventureCollectionDataModel } from "./adventure-collection-model.js";
export { GroupManagerApp }            from "./group-manager-app.js";
export { ManagerApp }             from "./manager-app.js";
export { NodeConfigApp }          from "./node-config-app.js";
export { NavHudApp }              from "./nav-hud-app.js";
export { LinkEditorApp }          from "./link-editor-app.js";
export { InstructionsApp }        from "./instructions-app.js";
export { AdventureSocketManager } from "./socket-manager.js";
export { HudStyleApp }            from "./hud-style-app.js";
export { AdventureIOApp }         from "./adventure-io-app.js";
export { shouldLockOnArrival, isUserLocked, lockUser, unlockUser } from "./autolock-utils.js";

// Main init — must be last because it references all the above
import "./click-adventure.js";
