export default class Player {
  public readonly id: number;
  public readonly guid: string;
  public readonly name: string;

  private _lobby: boolean;

  constructor(id: number, guid: string, name: string, lobby: boolean) {
    this.id = id;
    this.guid = guid;
    this.name = name;

    this._lobby = lobby;
  }

  public get lobby(): boolean {
    return this._lobby;
  }

  public set lobby(v: boolean) {
    this._lobby = v;
  }
}
