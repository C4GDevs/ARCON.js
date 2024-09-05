import ArconError from './ArconError';
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
  playerList:
    /^(\d+)\s+([\d.]+):\d+\s+([-0-9]+)\s+((?:[a-z0-9]){32}|-)(?:\((\?|OK)\)|)\s+(.+?)(?:(?: \((Lobby)\)$|$))/gm,
  playerMessage: /^\(([a-zA-Z]+)\) (.+)$/,
  adminMessage: /RCon admin #(\d+): \((.+?)\) (.+)$/
};

export declare interface Arcon {
  on(event: 'connected', listener: () => void): this;
  on(event: 'disconnected', listener: (reason: string, abortReconnect: boolean) => void): this;
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
  private _ready = false;

  private _players: Map<number, Player> = new Map();
  private _connectingPlayers: Map<number, Partial<Player>> = new Map();
  private _playerUpdateRate: number;
  private _playerUpdateInterval: NodeJS.Timeout;

  private _commandQueueInterval: NodeJS.Timeout;
  private _commandQueue: string[] = [];
  private _packetParts: CommandPacketPart[] = [];
  private _waitingForCommandResponse = false;

  constructor(options: ArconOptions) {
    super(options);

    this._playerUpdateRate = options.playerUpdateInterval ?? 5000;

    this.prependListener('connected', () => {
      this._commandQueueInterval = setInterval(() => {
        this._processCommandQueue();
      }, 500);

      this._playerUpdateInterval = setInterval(() => {
        this.sendCommand('players');
      }, this._playerUpdateRate);

      this.sendCommand('players');
    });
  }

  override close(reason?: string, abortReconnect?: boolean) {
    this._players = new Map();
    this._connectingPlayers = new Map();
    this._packetParts = [];
    this._commandQueue = [];
    this._waitingForCommandResponse = false;
    this._ready = false;

    clearInterval(this._playerUpdateInterval);
    clearInterval(this._commandQueueInterval);

    return super.close(reason, abortReconnect);
  }

  public get players() {
    return this._players;
  }

  /**
   * Sends a command to the server.
   * @param command Formatted command data.
   * @example arcon.sendCommand('reassign');
   * @example arcon.sendCommand('say -1 Hello Everyone');
   */
  public sendCommand(command: string) {
    this._commandQueue.push(command);
  }

  private static _getMessageType(message: string) {
    for (const [type, regex] of Object.entries(regexes)) {
      if (regex.test(message)) {
        return type;
      }
    }
  }

  protected override _handleCommandPacket(packet: Packet | CommandPacketPart) {
    let commandPacket: Packet | null = null;

    if (packet instanceof CommandPacketPart) {
      this._packetParts.push(packet);

      if (packet.totalPackets === this._packetParts.length) {
        const sortedParts = this._packetParts.sort((a, b) => a.packetIndex - b.packetIndex);

        const data = Buffer.concat(sortedParts.map((part) => part.data));

        commandPacket = Packet.create(PacketTypes.Command, data, packet.sequence);
      }
    } else commandPacket = packet;

    if (!commandPacket || !commandPacket.data || !commandPacket.data.length) return;

    this._waitingForCommandResponse = false;

    this._packetParts = [];

    const type = Arcon._getMessageType(commandPacket.data.toString());

    if (!type) {
      this.emit('error', new Error(`Unknown command type: ${commandPacket.data}`));
      return;
    }

    switch (type) {
      case 'playerList':
        this._playerList(commandPacket.data.toString());
        break;
    }
  }

  override _handleMessagePacket(packet: Packet) {
    super._handleMessagePacket(packet);

    if (!packet.data) return;

    const data = packet.data.toString();

    // Ignore rcon admins logging in
    if ((data.startsWith('RCon admin') && data.endsWith('logged in')) || !this._ready) return;

    const type = Arcon._getMessageType(data);

    if (!type) {
      this.emit('error', new Error(`Unknown message type: ${data}`));
      return;
    }

    switch (type) {
      case 'playerConnected':
        this._playerConnected(data);
        break;

      case 'playerGuidCalculated':
        this._playerGuidCalculated(data);
        break;

      case 'playerGuidVerified':
        this._playerGuidVerified(data);
        break;

      case 'playerDisconnected':
        this._playerDisconnected(data);
        break;

      case 'playerKicked':
        this._playerKicked(data);
        break;

      case 'beLog':
        this._beLog(data);
        break;

      case 'playerMessage':
        this._playerMessage(data);
        break;

      case 'adminMessage':
        this._adminMessage(data);
        break;
    }
  }

  // Initial connection of player
  private _playerConnected(data: string) {
    const match = data.match(regexes.playerConnected);

    if (!match) {
      this.emit('error', new ArconError(`Could not parse 'playerConnected' event: ${data}`));
      return;
    }

    const [, idStr, name, ip] = match;

    const id = parseInt(idStr);

    this._connectingPlayers.set(id, { name, ip, id });
  }

  // First time player GUID is available
  private _playerGuidCalculated(data: string) {
    const match = data.match(regexes.playerGuidCalculated);

    if (!match) {
      this.emit('error', new ArconError("Could not parse 'playerGuidCalculated' event", data));
      return;
    }

    const [, idStr, , guid] = match;

    const id = parseInt(idStr);

    let player = this._connectingPlayers.get(id);

    if (!player) {
      this.emit('error', new ArconError(`playerGuidCalculated: Player #${id} not found.`, data));
      return;
    }

    player = { ...player, guid };

    this._connectingPlayers.set(id, player);
  }

  // First time player GUID is available and reliable
  private _playerGuidVerified(data: string) {
    const match = data.match(regexes.playerGuidVerified);

    if (!match) {
      this.emit('error', new ArconError("Could not parse 'playerGuidVerified' event", data));
      return;
    }

    const [, idStr] = match;

    const id = parseInt(idStr);

    const player = this._connectingPlayers.get(id);

    if (!player) {
      this.emit('error', new ArconError(`playerGuidVerified: Player #${id} not found.`, data));
      return;
    }

    this._connectingPlayers.delete(id);

    const newPlayer = new Player(player.guid!, player.id!, player.ip!, player.name!, 0, true, true);

    this._players.set(newPlayer.id, newPlayer);

    this.emit('playerConnected', newPlayer);
  }

  // Player disconnected
  private _playerDisconnected(data: string) {
    const match = data.match(regexes.playerDisconnected);

    if (!match) {
      this.emit('error', new ArconError("Could not parse 'playerDisconnected' event", data));
      return;
    }

    const [, idStr] = match;

    const id = parseInt(idStr);

    const player = this._players.get(id);

    if (!player) {
      if (this._connectingPlayers.has(id)) {
        this._connectingPlayers.delete(id);
        return;
      }

      this.emit('error', new ArconError(`playerDisconnected: Player #${id} not found.`, data));
      return;
    }

    this._players.delete(id);

    this.emit('playerDisconnected', player, 'disconnected');
  }

  // Player was kicked
  private _playerKicked(data: string) {
    const match = data.match(regexes.playerKicked);

    if (!match) {
      this.emit('error', new ArconError("Could not parse 'playerKicked' event", data));
      return;
    }

    const [, idStr, reason] = match;

    const id = parseInt(idStr);

    const player = this._players.get(id);

    if (!player) {
      this.emit('error', new ArconError(`playerKicked: Player #${id} not found.`, data));
      return;
    }

    this._players.delete(id);

    this.emit('playerDisconnected', player, reason);
  }

  // BattlEye log message
  private _beLog(data: string) {
    const match = data.match(regexes.beLog);

    if (!match) {
      this.emit('error', new ArconError("Could not parse 'beLog' event", data));
      return;
    }

    const [, type, idStr, guid, filterStr, log] = match;

    const id = parseInt(idStr);

    const player = this._players.get(id);

    if (!player) this.emit('error', new ArconError(`beLog: Player #${id} not found.`, data));

    const filter = parseInt(filterStr);

    const beLog: BeLog = {
      type,
      filter,
      log,
      guid,
      player
    };

    this.emit('beLog', beLog);
  }

  private _playerList(data: string) {
    const players = data.matchAll(regexes.playerList);

    for (const player of players) {
      const [, idStr, ip, pingStr, guid, verifiedStr, name, lobbyStr] = player;

      const id = parseInt(idStr);
      const ping = parseInt(pingStr);
      const verified = verifiedStr === 'OK';
      const lobby = lobbyStr === 'Lobby';

      const existingPlayer = this._players.get(id);

      if (this._connectingPlayers.has(id)) continue;

      if (guid === '-') {
        this._connectingPlayers.set(id, { id, ip, name });
        continue;
      }

      if (existingPlayer) {
        const changes = [
          existingPlayer.ping !== ping,
          existingPlayer.lobby !== lobby,
          existingPlayer.verified !== verified
        ];

        if (changes.some((c) => c)) {
          existingPlayer.ping = ping;
          existingPlayer.lobby = lobby;
          existingPlayer.verified = verified;

          this.emit('playerUpdated', existingPlayer, changes);
        }
      } else {
        if (this._ready) continue;

        const newPlayer = new Player(guid, id, ip, name, ping, lobby, verified);

        this._players.set(id, newPlayer);
      }
    }

    this.emit('players', [...this._players.values()]);

    if (!this._ready) {
      this._ready = true;
    }
  }

  // Player sends a message
  private _playerMessage(data: string) {
    const match = data.match(regexes.playerMessage);

    if (!match) {
      this.emit('error', new ArconError("Could not parse 'playerMessage' event", data));
      return;
    }

    const [, channel, message] = match;

    // Find all players that match the start of the message
    // and sort them by name length, longest name is best match.
    const matchingNames = [...this._players.values()]
      .filter((p) => message.startsWith(p.name))
      .sort((a, b) => b.name.length - a.name.length);

    if (matchingNames.length === 0) {
      this.emit('error', new ArconError(`playerMessage: No player found for message: ${message}`, data));
      return;
    }

    const player = matchingNames[0];

    const text = message.slice(player.name.length + 2);

    this.emit('playerMessage', player, channel, text);
  }

  // RCon admin sends a message
  private _adminMessage(data: string) {
    const match = data.match(regexes.adminMessage);

    if (!match) {
      this.emit('error', new ArconError("Could not parse 'adminMessage' event", data));
      return;
    }

    const [, idStr, channel, message] = match;

    const id = parseInt(idStr);

    this.emit('adminMessage', id, channel, message);
  }

  private _processCommandQueue() {
    if (this._waitingForCommandResponse) return;

    const command = this._commandQueue.shift();

    if (!command) return;

    this._waitingForCommandResponse = true;

    const packet = Packet.create(PacketTypes.Command, Buffer.from(command), this._getSequence());

    this._send(packet.toBuffer());
  }
}
