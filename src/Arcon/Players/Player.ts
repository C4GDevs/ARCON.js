export default class Player {
  public readonly id: number;
  public readonly guid: string;
  public readonly name: string;

  private _ip: string;
  private _lobby: boolean;

  constructor(id: number, guid: string, name: string, lobby: boolean, ip?: string) {
    this.id = id;
    this.guid = guid;
    this.name = name;

    if (ip) this._ip = ip;

    this._lobby = lobby;
  }

  public get lobby(): boolean {
    return this._lobby;
  }

  public set lobby(v: boolean) {
    this._lobby = v;
  }

  public get ip(): string {
    return this._ip;
  }
  public set ip(v: string) {
    this._ip = v;
  }
}
