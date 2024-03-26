export class Player {
  /** BattlEye GUID of player. */
  private _guid: string;
  /** ID of player. */
  private _id: number;
  /** IP of player. */
  private _ip: string;
  /** Name of player. */
  private _name: string;
  /** Ping of player. */
  private _ping: number;
  /** Whether the player is in the lobby. */
  private _lobby: boolean;
  /** Whether the GUID has verified by server. */
  private _verified: boolean;

  constructor(guid: string, id: number, ip: string, name: string, ping: number, lobby: boolean, verified: boolean) {
    this._guid = guid;
    this._id = id;
    this._ip = ip;
    this._name = name;
    this._ping = ping;
    this._lobby = lobby;
    this._verified = verified;
  }

  get guid() {
    return this._guid;
  }

  get id() {
    return this._id;
  }

  get ip() {
    return this._ip;
  }

  get name() {
    return this._name;
  }

  get ping() {
    return this._ping;
  }

  set ping(ping: number) {
    this._ping = ping;
  }

  get lobby() {
    return this._lobby;
  }

  set lobby(lobby: boolean) {
    this._lobby = lobby;
  }

  get verified() {
    return this._verified;
  }

  set verified(verified: boolean) {
    this._verified = verified;
  }
}
