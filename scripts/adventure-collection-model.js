/**
 * DataModel for the multi-graph collection stored as world setting `click-adventure.graphs`.
 * Replaces the single-graph `click-adventure.graph` setting with a named, switchable collection.
 *
 * Each entry in `graphs` matches the old AdventureDataModel shape plus an `id` and `name`:
 *   { id, name, startNodeId, nodes: [], links: [] }
 */
export class AdventureCollectionDataModel extends foundry.abstract.DataModel {
  /** @override */
  static defineSchema() {
    const { ArrayField, ObjectField, StringField } = foundry.data.fields;
    return {
      /**
       * Id of the currently active graph.
       * Manager and HUD always operate on this graph.
       * @type {string}
       */
      activeGraphId: new StringField({ required: true, initial: "" }),
      /**
       * All named graphs in this world.
       * Shape per entry: { id, name, startNodeId, nodes: [], links: [] }
       * @type {Array<object>}
       */
      graphs: new ArrayField(new ObjectField())
    };
  }
}
