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
       * Legacy graph-level scene binding — unused in the per-node scene architecture.
       * Kept in schema to avoid DataModel validation errors on existing settings data.
       * @type {string}
       */
      sceneId: new StringField({ required: true, initial: "" }),
      /**
       * The id of the graph node that is the starting position for all players.
       * Set via the NodeConfigApp toggle; per-user current position is tracked in user flags.
       * @type {string}
       */
      startNodeId: new StringField({ required: true, initial: "" }),
      /**
       * Node shape: { id, label, images: [{id,src,label}], activeImageIndex, x, y, sceneId }
       * sceneId (per-node) holds the Foundry Scene id created for that node; null until "Create Scenes" runs.
       * @type {Array<{id:string, label:string, images:object[], activeImageIndex:number, x:number, y:number, sceneId:string|null}>}
       */
      nodes: new ArrayField(new ObjectField()),
      /** @type {Array<{sourceId:string, sourceAnchor:string, targetId:string, targetAnchor:string}>} */
      links: new ArrayField(new ObjectField())
    };
  }
}
