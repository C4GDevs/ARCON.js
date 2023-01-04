export default class Player {
  public readonly id: number;
  public readonly guid: string;
  public readonly name: string;
  public readonly connectedAt: Date;

  private _ip: string | undefined;
  private _lobby: boolean;
  private _ping: number;

  constructor(id: number, guid: string, name: string, lobby: boolean, ip?: string, ping?: number) {
    this.id = id;
    this.guid = guid;
    this.name = name;

    if (ip) this._ip = ip;
    if (ping) this._ping = ping;

    this._lobby = lobby;

    this.connectedAt = new Date();
  }

  public get lobby(): boolean {
    return this._lobby;
  }

  public set lobby(v: boolean) {
    this._lobby = v;
  }

  public get ip(): string | undefined {
    return this._ip;
  }

  public set ip(v: string | undefined) {
    this._ip = v;
  }

  public get ping(): number {
    return this._ping;
  }

  public set ping(v: number) {
    this._ping = v;
  }
}
