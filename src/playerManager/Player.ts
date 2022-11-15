interface PlayerOptions {
  name: string;
  guid: string;
  id: number;
  ip: string;
  lobby: boolean;
}

export default class Player {
  public readonly name: string;
  public readonly id: number;
  public readonly ip: string;
  public readonly connectedAt: Date;

  private _guid: string;
  private _lobby: boolean;

  constructor({ name, guid, id, ip, lobby }: PlayerOptions) {
    this.name = name;
    this.id = id;
    this.ip = ip;
    this.connectedAt = new Date();

    this._guid = guid;
    this._lobby = lobby;
  }

  public get guid() {
    return this._guid;
  }

  public get lobby() {
    return this._lobby;
  }

  public set lobby(v: boolean) {
    this._lobby = v;
  }

  public toJSON() {
    const entries = Object.entries(this);
    const output: { [key: string]: unknown } = {};

    for (const [key, value] of entries) {
      output[key] = value;
    }

    return output;
  }
}
