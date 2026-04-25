/**
 * DataModel representing the full adventure graph persisted as a world-scoped module Setting.
 * Nodes hold position and cosmetic data; links encode directed edges between nodes.
 *
 * Registered in the `init` hook via game.settings.register with type: AdventureDataModel.
 */
export class AdventureDataModel extends foundry.abstract.DataModel {
  /** @override */
  static defineSchema() {
    const { ArrayField, ObjectField } = foundry.data.fields;
    return {
      /** @type {Array<{id:string, label:string, imageSrc:string, x:number, y:number}>} */
      nodes: new ArrayField(new ObjectField()),
      /** @type {Array<{sourceId:string, targetId:string}>} */
      links: new ArrayField(new ObjectField())
    };
  }
}
