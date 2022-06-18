interface PlayerOptions {
  name: string;
  guid: string;
  id: number;
  ip: string;
  lobby: boolean;
}

export default class Player {
  public readonly name: string;
  public readonly guid: string;
  public readonly id: number;
  public readonly ip: string;

  public lobby: boolean;

  constructor({ name, guid, id, ip, lobby }: PlayerOptions) {
    this.name = name;
    this.guid = guid;
    this.id = id;
    this.ip = ip;
    this.lobby = lobby;
  }
}
