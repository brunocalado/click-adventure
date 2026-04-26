/**
 * DataModel representing the full adventure graph persisted as a world-scoped module Setting.
 * Nodes hold position and cosmetic data; links encode directed edges between nodes.
 * The entire graph is bound to a single Foundry Scene; navigation changes the tile texture,
 * never the active scene.
 *
 * Registered in the `init` hook via game.settings.register with type: AdventureDataModel.
 */
export class AdventureDataModel extends foundry.abstract.DataModel {
  /** @override */
  static defineSchema() {
    const { ArrayField, ObjectField, StringField } = foundry.data.fields;
    return {
      /**
       * The Foundry Scene id this entire graph is bound to.
       * Empty string means no scene has been created yet.
       * @type {string}
       */
      sceneId: new StringField({ required: true, initial: "" }),
      /**
       * The id of the graph node the player is currently "at" for HUD navigation.
       * Updated on every successful _navigateTo call.
       * @type {string}
       */
      currentNodeId: new StringField({ required: true, initial: "" }),
      /**
       * Node shape: { id, label, images: [{id,src,label}], activeImageIndex, x, y }
       * sceneId is intentionally NOT a per-node property.
       * @type {Array<{id:string, label:string, images:object[], activeImageIndex:number, x:number, y:number}>}
       */
      nodes: new ArrayField(new ObjectField()),
      /** @type {Array<{sourceId:string, sourceAnchor:string, targetId:string, targetAnchor:string}>} */
      links: new ArrayField(new ObjectField())
    };
  }
}
