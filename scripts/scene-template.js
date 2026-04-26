/**
 * Returns a plain Scene creation data object based on the Click Adventure scene template.
 * Strips runtime-generated fields (_id, _stats, ownership) that must not be passed to Scene.create().
 *
 * The tile references modules/click-adventure/assets/imgs/empty.webp — verify this asset exists.
 *
 * @param {string} name - Name for the new scene (defaults to "Click Adventure Scene")
 * @returns {object} Scene data suitable for Scene.create()
 */
export function buildSceneData(name = "Click Adventure Scene") {
  return {
    name,
    navigation: true,
    navOrder: 0,
    width: 1920,
    height: 1080,
    padding: 0,
    shiftX: 0,
    shiftY: 0,
    initial: { x: 1141, y: 546, scale: 0.796 },
    initialLevel: "defaultLevel0000",
    grid: {
      type: 1,
      size: 100,
      style: "solidLines",
      thickness: 1,
      color: "#000000",
      alpha: 0,
      distance: 5,
      units: "ft"
    },
    tokenVision: false,
    fog: { mode: 1, colors: { explored: null, unexplored: null } },
    environment: {
      darknessLevel: 0,
      darknessLock: false,
      globalLight: {
        enabled: false, alpha: 0.5, bright: false, color: null,
        coloration: 1, luminosity: 0, saturation: 0, contrast: 0, shadows: 0,
        darkness: { min: 0, max: 1 }
      },
      cycle: true,
      base: { hue: 0, intensity: 0, luminosity: 0, saturation: 0, shadows: 0 },
      dark: { hue: 0.7138888888888889, intensity: 0, luminosity: -0.25, saturation: 0, shadows: 0 }
    },
    transition: { type: null, duration: 1500, activeOnly: false },
    drawings: [],
    tokens: [],
    levels: [
      {
        _id: "defaultLevel0000",
        name: "Level",
        elevation: { bottom: 0, top: 20 },
        background: { color: "#000000", src: null, tint: "#ffffff", alphaThreshold: 0.75 },
        foreground: { src: null, tint: "#ffffff", alphaThreshold: 0.75 },
        fog: { src: null, tint: "#ffffff" },
        textures: { anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0, fit: "fill", scaleX: 1, scaleY: 1, rotation: 0 },
        visibility: { levels: [] },
        sort: 0,
        flags: {}
      }
    ],
    lights: [],
    notes: [],
    sounds: [],
    regions: [],
    tiles: [
      {
        texture: {
          src: "modules/click-adventure/assets/imgs/empty.webp",
          anchorX: 0.5, anchorY: 0.5,
          scaleX: 1, scaleY: 1,
          tint: "#ffffff", fit: "fill", alphaThreshold: 0.75
        },
        x: 960, y: 540,
        width: 1920, height: 1080,
        sort: 0, elevation: 0,
        levels: ["defaultLevel0000"],
        alpha: 1,
        restrictions: { light: false, weather: false },
        occlusion: { modes: [], alpha: 0 },
        video: { loop: true, autoplay: true, volume: 0 },
        flags: {},
        rotation: 0, hidden: false, locked: false, name: ""
      }
    ],
    walls: [],
    playlist: null, playlistSound: null,
    journal: null, journalEntryPage: null,
    weather: "",
    flags: {
      "click-adventure": {
        isAdventureScene: true
      }
    },
    navName: ""
  };
}
