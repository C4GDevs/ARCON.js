interface PlayerOptions {
  name: string;
  guid: string;
  id: number;
  ip: string;
  port: number;
}

export default class Player {
  public readonly name: string;
  public readonly guid: string;
  public readonly id: number;
  public readonly ip: string;
  public readonly port: number;

  constructor({ name, guid, id, ip, port }: PlayerOptions) {
    this.name = name;
    this.guid = guid;
    this.id = id;
    this.ip = ip;
    this.port = port;
  }
}
