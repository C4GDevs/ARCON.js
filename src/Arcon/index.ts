import { BaseClient, ClientOptions } from './client';
import { CommandPacketPart, Packet, PacketTypes } from './packet';
import { Player } from './player';

export interface ArconOptions extends ClientOptions {
  /** The interval for updating player data. Minimum 5000ms. */
  playerUpdateInterval?: number;
}

export interface BeLog {
  type: string;
  filter: number;
  log: string;
  guid: string;
  player?: Player;
}

const regexes = {
  playerConnected: /^Player #(\d+) (.+) \(([\d.]+):\d+\) connected$/,
  playerGuidCalculated: /^Player #(\d+) (.+) BE GUID: ([a-z0-9]{32})$/,
  playerGuidVerified: /^Verified GUID \([a-z0-9]{32}\) of player #(\d+) .+$/,
  playerDisconnected: /^Player #(\d+) (.+) disconnected$/,
  playerKicked: /^Player #(\d+) .+ \([a-z0-9]{32}\) has been kicked by BattlEye: (.+)$/,
  beLog: /^([a-zA-Z]+) Log: #(\d+) .+ \(([a-z0-9]{32})\) - #(\d+) (.+)$/,
  playerList: /^(\d+)\s+([\d.]+):\d+\s+([-0-9]+)\s+((?:[a-z0-9]){32})\((\?|OK)\)\s+(.+?)(?:(?: \((Lobby)\)$|$))/gm,
  playerMessage: /^\(([a-zA-Z]+)\) (.+)$/,
  adminMessage: /RCon admin #(\d+): \((.+?)\) (.+)$/
};

export declare interface Arcon {
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'players', listener: (players: Player[]) => void): this;
  on(event: 'playerConnected', listener: (player: Player) => void): this;
  on(event: 'playerDisconnected', listener: (player: Player, reason: string) => void): this;
  on(event: 'playerUpdated', listener: (player: Player, changes: [boolean, boolean, boolean]) => void): this;
  on(event: 'beLog', listener: (log: BeLog) => void): this;
  on(event: 'playerMessage', listener: (player: Player, channel: string, message: string) => void): this;
  on(event: 'adminMessage', listener: (id: number, channel: string, message: string) => void): this;
}

export class Arcon extends BaseClient {
  constructor(options: ArconOptions) {
    super(options);
  }

  override close(abortReconnect: boolean) {
    super.close(abortReconnect);
  }

  public get players() {}

  /**
   * Adds a command to the queue to be sent to the server.
   * @param command Formatted command data.
   * @example arcon.sendCommand('reassign');
   * @example arcon.sendCommand('say -1 Hello Everyone');
   */
  public sendCommand(command: string) {}
}
