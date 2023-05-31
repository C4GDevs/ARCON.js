import BaseError from './errors/base-error';

export interface Identifier {
  id: number;
  name: string;
  ip: string;
}

export interface Player extends Identifier {
  guid: string;
}

export enum PacketType {
  Login = 0x00,
  Command = 0x01,
  Message = 0x02
}

export interface Packet {
  prefix: string;
  type: PacketType;
  checksum: string;
  data: Buffer;
}

export type Events = {
  error: (err: BaseError) => void;
  playerJoin: (player: Player) => void;
  playerLeave: (player: Player) => void;
};

/**
 * Options for Arcon constructor.
 */
export interface ConnectionOptions {
  ip: string;
  port: number;
  password: string;
  /**
   * The interval in milliseconds to send a `players` command to the server.
   * Must be greater than 1000ms and less than 40000ms.
   */
  heartbeatInterval?: number;
}
