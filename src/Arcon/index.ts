import { EventEmitter } from 'events';
import { createSocket, Socket } from 'dgram';
import { Packet, createPacket, LoginPacket, PacketError, PacketTypes, CommandPacketPart } from './packet';
import { Player } from './player';

interface ClientOptions {
  /** Host of the RCON server. */
  host: string;
  /** Port of the RCON server. */
  port: number;
  /** The password of the RCON server. */
  password: string;
  /**
   * Whether to automatically reconnect to the server if disconnected.
   * Does not reconnect if the `password` is incorrect.
   * @default true
   */
  autoReconnect?: boolean;
}

/**
 * The main class for interacting with an ARMA III Battleye RCON server.
 * @extends EventEmitter
 */
class Arcon extends EventEmitter {
  /** A list of command packet fragments. */
  private _commandPacketParts: Map<number, CommandPacketPart[]> = new Map();

  /** A list of commands that are waiting for a response. */
  private _commandQueue: Packet[] = [];

  /** The interval for sending commands from the queue. */
  private _commandSendInterval: NodeJS.Timeout;

  /** Whether the client has logged into the RCON server */
  private _connected: boolean = false;

  private _connectingPlayers: Map<number, { name: string; ip: string }> = new Map();

  /** Heartbeat loop handler, only runs while logged in. */
  private _heartbeatInterval: NodeJS.Timeout;

  /** The last time a command was sent to the server. */
  private _lastCommandSentAt: Date = new Date();

  /** The last sequence number used for a command. */
  private _lastCommandSequence: number;

  /** The last time a packet was received from the server. */
  private _lastPacketReceivedAt: Date;

  /** Login packet timeout handler. */
  private _loginTimeout: NodeJS.Timeout;

  /** A list of players currently connected to the server. */
  private _players: Player[] = [];

  /**
   * Whether we are ignoring messages from the server.
   * True until we receive the list of players from the server.
   */
  private _ignoringMessages: boolean = true;

  /** The sequence number of the next packet to send. Ranges from 0 to 255. */
  private _sequenceNumber: number = 0;

  /** The socket used to communicate with the server. */
  private _socket: Socket;

  private _host: string;
  private _port: number;
  private _password: string;
  private _autoReconnect: boolean;

  /**
   * @param options - The options for the ARCON instance.
   */
  constructor({ host, port, password, autoReconnect }: ClientOptions) {
    super();

    this._host = host;
    this._port = port;
    this._password = password;
    this._autoReconnect = autoReconnect ?? true;
  }

  /**
   * Opens a socket to the server and login.
   */
  connect() {
    if (this._connected) return;
    this._socket = createSocket('udp4');

    this._socket.on('message', (buf) => this._parseMessage(buf));

    this._socket.once('connect', () => this._sendLogin());

    this._socket.on('error', (error) => {
      this.emit('error', error);
      this.close(false);
    });

    this._socket.connect(this._port, this._host);
  }

  /**
   * Whether the client is connected to the RCON server.
   */
  public get connected() {
    return this._connected;
  }

  /**
   * Closes the socket to the server.
   * @param abortReconnect Whether to abort the reconnection process.
   * @param emit Whether to emit the `disconnected` event.
   */
  close(abortReconnect: boolean, emit: boolean = true) {
    this._socket.close();
    this._connected = false;

    clearInterval(this._heartbeatInterval);
    clearInterval(this._commandSendInterval);

    this._sequenceNumber = 0;

    this._commandQueue = [];
    this._commandPacketParts.clear();

    this._ignoringMessages = true;

    this._players = [];

    if (emit) this.emit('disconnected');

    if (abortReconnect || !this._autoReconnect) return;

    setTimeout(() => this.connect(), 5000);
  }

  /**
   * Parses command data and handles it accordingly.
   * @param packet The parsed packet from the server.
   */
  private _handleCommand(packet: Packet) {
    if (!packet.data) return;

    const data = packet.data.toString();

    // response from `players` command
    if (data.startsWith('Players on server:')) {
      /**
       * Matches the following pattern:
       * [id] [IP Address]:[Port] [Ping] [GUID] [Name] (Lobby)
       */
      const players = data.matchAll(
        /^(\d+)\s+([\d\.]+):\d+\s+([-0-9]+)\s+((?:[a-z0-9]){32})\((\?|OK)\)\s+(.+?)(?:(?: \((Lobby)\)$|$))/gm
      );

      for (const player of players) {
        const [_, idStr, ip, pingStr, guid, verifiedStr, name, lobbyStr] = player;

        const id = parseInt(idStr);
        const ping = parseInt(pingStr);
        const verified = verifiedStr === 'OK';
        const lobby = lobbyStr === 'Lobby';

        const existingPlayer = this._players.find((p) => p.id === id);

        // Update the player if they already exist.
        if (existingPlayer) {
          const _changes = [
            existingPlayer.ping !== ping,
            existingPlayer.verified !== verified,
            existingPlayer.lobby !== lobby
          ];

          existingPlayer.lobby = lobby;
          existingPlayer.ping = ping;
          existingPlayer.verified = verified;

          if (_changes.some((c) => c)) this.emit('playerUpdated', existingPlayer, _changes);
          continue;
        }

        // Only add to players list if we haven't fetched them yet.
        if (this._ignoringMessages) this._players.push(new Player(guid, id, ip, name, ping, lobby, verified));
      }

      this.emit('players', this._players);
      if (this._ignoringMessages) this._ignoringMessages = false;
      return;
    }
  }

  /**
   * Determines whether the login was successful.
   * @param packet The parsed packet from the server.
   */
  private _handleLogin(packet: LoginPacket) {
    clearTimeout(this._loginTimeout);

    // Password in incorrect.
    if (packet.data.toString() === '0') {
      this.emit('error', new Error('Login failed'));
      this.close(true);
      return;
    }

    this._connected = true;

    // Update the last packet received time to stop disconnecting from
    // occurring immediately after login.
    this._lastPacketReceivedAt = new Date();

    this._heartbeatInterval = setInterval(() => this._heartbeat(), 1000);
    this._commandSendInterval = setInterval(() => this._sendCommand(), 100);

    // Get the list of players. We won't handle messages before receiving this.
    this._queueCommand('players');

    this.emit('connected');
  }

  /**
   * Handles raw data received from the server.
   * @param buf Raw packet data.
   */
  private _parseMessage(buf: Buffer) {
    const packet = createPacket(buf);

    if (packet instanceof PacketError) return this.emit('error', packet);

    // If the packet is a login packet, the server does not want a response.
    if (packet instanceof LoginPacket) return this._handleLogin(packet);

    this._lastPacketReceivedAt = new Date();

    if (packet instanceof Packet) {
      if (packet.type === PacketTypes.Message) return this._handleServerMessage(packet);

      return this._handleCommand(packet);
    }

    /**
     * Packet is fragmented due to UDP packet size limits.
     * We need to reassemble the packet before handling it.
     */

    if (packet.sequence !== this._commandQueue[0]?.sequence) return;

    const packetParts = this._commandPacketParts.get(packet.sequence);

    // If the packet is the first fragment, create a new list.
    if (!packetParts) return this._commandPacketParts.set(packet.sequence, [packet]);

    // Add the packet to the list of fragments.
    packetParts.push(packet);

    // If we have all the fragments, reassemble the packet.
    if (packetParts.length === packetParts[0].totalPackets) {
      // Remove the command from the list of waiting commands.
      this._commandPacketParts.delete(packet.sequence);
      this._commandQueue.shift();

      // UDP packets can arrive out of order, so we need to sort them.
      const sortedParts = packetParts.sort((a, b) => a.packetIndex - b.packetIndex);

      const data = Buffer.concat(sortedParts.map((part) => part.data));

      const fullPacket = Packet.create(PacketTypes.Command, data, packet.sequence);

      this._handleCommand(fullPacket);
    }
  }

  /**
   * Handles a `Message` packet from the server.
   * @param packet The parsed packet to handle.
   */
  private _handleServerMessage(packet: Packet) {
    // All server messages require a response.
    const response = Packet.create(PacketTypes.Message, null, packet.sequence);

    this._socket.send(response.toBuffer());

    if (this._ignoringMessages || !packet.data) return;

    const data = packet.data.toString();

    // Player connected
    if (/^Player #(\d+) (.+) \(([\d\.]+):\d+\) connected$/.test(data)) {
      const [_, idStr, name, ip] = data.match(/^Player #(\d+) (.+) \(([\d\.]+):\d+\) connected$/) ?? [];

      if (!idStr || !name || !ip) return;

      const id = parseInt(idStr);

      this._connectingPlayers.set(id, { name, ip });
      return;
    }

    // Player guid calculated
    if (/^Player #(\d+) (.+) BE GUID: ([a-z0-9]{32})$/.test(data)) {
      const [_, idStr, name, guid] = data.match(/^Player #(\d+) (.+) BE GUID: ([a-z0-9]{32})$/) ?? [];

      if (!idStr || !name || !guid) return;

      const id = parseInt(idStr);

      const playerInfo = this._connectingPlayers.get(id);

      if (!playerInfo) return;

      const player = new Player(guid, id, playerInfo.ip, playerInfo.name, -1, true, false);

      this._players.push(player);
      return;
    }

    // Player guid verified
    if (/^Verified GUID \([a-z0-9]{32}\) of player #(\d+) .+$/.test(data)) {
      const [_, idStr] = data.match(/^Verified GUID \([a-z0-9]{32}\) of player #(\d+) .+$/) ?? [];

      if (!idStr) return;

      const id = parseInt(idStr);

      const player = this._players.find((p) => p.id === id);

      if (!player) return;

      player.verified = true;

      this.emit('playerConnected', player);
      return;
    }

    // Player disconnected
    if (/^Player #(\d+) (.+) disconnected$/.test(data)) {
      const [_, idStr] = data.match(/^Player #(\d+) .+ disconnected$/) ?? [];

      if (!idStr) return;

      const id = parseInt(idStr);

      const player = this._players.find((p) => p.id === id);

      if (!player) return;

      this._players = this._players.filter((p) => p.id !== id);

      this.emit('playerDisconnected', player, 'disconnected');
      return;
    }

    // Player kicked
    if (/^Player #(\d+) .+ \([a-z0-9]{32}\) has been kicked by BattlEye: (.+)$/) {
      const [_, idStr, reason] =
        data.match(/^Player #(\d+) .+ \([a-z0-9]{32}\) has been kicked by BattlEye: (.+)$/) ?? [];

      if (!idStr || !reason) return;

      const id = parseInt(idStr);

      const player = this._players.find((p) => p.id === id);

      if (!player) return;

      this._players = this._players.filter((p) => p.id !== id);

      this.emit('playerDisconnected', player, `${reason}`);
    }

    // TODO: Handle BattlEye logs
    if (/^[a-zA-Z]+ Log/.test(data)) return;
  }

  /**
   * Check if the connection is still alive, and send a heartbeat packet if necessary.
   *
   * RCON protocol expects an empty command packet at least every 45 seconds if no other packets are sent.
   * We've lowered this drastically to minimize the time it takes to detect a dead connection.
   */
  private _heartbeat() {
    if (!this._connected) return;

    const now = new Date();
    const delta = now.getTime() - this._lastPacketReceivedAt.getTime();

    // If we haven't received a packet in 10 seconds, the connection is dead.
    if (delta > 10_000) {
      this.emit('error', new Error('Connection timeout'));
      this.close(false);
      return;
    }

    // Send a heartbeat packet every 2.5 seconds.
    if (delta > 2_500) {
      this._queueCommand('players');
    }
  }

  /**
   * Sends a command to the server from the queue.
   */
  private _sendCommand() {
    if (!this._connected) return;

    if (this._commandQueue.length === 0) return;

    // TODO: There should be a better way to handle this.

    const packet = this._commandQueue[0];

    const now = new Date();
    const delta = now.getTime() - this._lastCommandSentAt.getTime();

    if (packet && delta > 1000) {
      this._lastCommandSentAt = new Date();

      // Prevent overflow of packet parts.
      this._commandPacketParts.delete(packet.sequence);

      this._socket.send(packet.toBuffer());
    }
  }

  /**
   * Sends the login packet to the server.
   */
  private _sendLogin() {
    const loginPacket = LoginPacket.create(PacketTypes.Login, Buffer.from(this._password));

    // Server is unreachable if it does not respond within 5 seconds.
    this._loginTimeout = setTimeout(() => {
      this.emit('error', new Error('Login timeout'));
      this.close(false);
    }, 5000);

    this._socket.send(loginPacket.toBuffer());
  }

  /**
   * Sends a command to the server.
   * @param command The command to send.
   */
  private _queueCommand(command: string) {
    if (!this._connected) return;
    const packet = Packet.create(PacketTypes.Command, Buffer.from(command), this._sequenceNumber++ % 256);

    this._commandQueue.push(packet);
  }
}

export default Arcon;
