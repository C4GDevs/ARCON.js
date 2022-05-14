import Packet from './Packet';
import PacketPart from './PacketPart';

class PacketManager {
  private _packets: Map<number, PacketPart[]>;

  constructor() {
    this._packets = new Map();
  }

  public getPacket(sequence: number) {
    const parts = this._packets.get(sequence);

    if (!parts) return null;

    let payload = '';

    for (const part of parts.sort((x, y) => x.index - y.index)) {
      payload += part.payload.toString();
    }

    this._packets.set(sequence, []);

    return new Packet(parts[0].type, sequence, payload);
  }

  public addPacket(packet: PacketPart) {
    const parts = this._packets.get(packet.sequence) || [];

    parts.push(packet);

    this._packets.set(packet.sequence, parts);
  }
}

export = PacketManager;
