import { EventEmitter } from 'events';
import { createSocket, Socket } from 'dgram';
import { Packet, createPacket, LoginPacket, PacketError, PacketTypes, CommandPacketPart } from './packet';

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
  /** Whether the client has logged into the RCON server */
  private _connected: boolean = false;
  /** The last time a packet was received from the server. */
  private _lastPacketReceivedAt: Date;
  /** The sequence number of the next packet to send. Ranges from 0 to 255. */
  private _sequenceNumber: number = 0;

  private _socket: Socket;

  /** A list of command packet fragments. */
  private _commandPacketParts: Map<number, CommandPacketPart[]> = new Map();

  /** A list of commands that are waiting for a response. */
  private _waitingCommands: Set<number> = new Set();

  private _host: string;
  private _port: number;
  private _password: string;
  private _autoReconnect: boolean;

  /**
   * Heartbeat loop handler, only runs while logged in.
   */
  private _heartbeatInterval: NodeJS.Timeout;

  /**
   * Login packet timeout handler.
   */
  private _loginTimeout: NodeJS.Timeout;

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

    this._socket.on('message', (buf) => this._handleMessage(buf));

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

    // Reset the sequence number incase we reconnect.
    this._sequenceNumber = 0;

    if (emit) this.emit('disconnected');

    if (abortReconnect || !this._autoReconnect) return;

    setTimeout(() => this.connect(), 5000);
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

    // Get the list of players.
    this._sendCommand('players');

    this.emit('connected');
  }

  /**
   * Handles raw data received from the server.
   * @param buf Raw packet data.
   */
  private _handleMessage(buf: Buffer) {
    const packet = createPacket(buf);

    if (packet instanceof PacketError) return this.emit('error', packet);

    // If the packet is a login packet, the server does not want a response.
    if (packet instanceof LoginPacket) return this._handleLogin(packet);

    this._lastPacketReceivedAt = new Date();

    if (packet instanceof Packet) {
      // All server messages require a response.
      if (packet.type === PacketTypes.Message) {
        const response = Packet.create(PacketTypes.Message, null, packet.sequence);

        this._socket.send(response.toBuffer());

        // TODO: Parse the message based on data.
        if (packet.data?.length) this.emit('message', packet.data.toString());
        return;
      }

      // TODO: Parse the command based on data.
      if (packet.data?.length) this.emit('message', packet.data.toString());
      return;
    }

    // Don't handle the packet if it's from a command we're not waiting for.
    if (!this._waitingCommands.has(packet.sequence)) return;

    const packetParts = this._commandPacketParts.get(packet.sequence);

    if (!packetParts) {
      this._commandPacketParts.set(packet.sequence, [packet]);
      return;
    }

    packetParts.push(packet);

    if (packetParts.length === packetParts[0].totalPackets) {
      // Remove the command from the list of waiting commands.
      this._commandPacketParts.delete(packet.sequence);
      this._waitingCommands.delete(packet.sequence);

      // UDP packets can arrive out of order, so we need to sort them.
      const sortedParts = packetParts.sort((a, b) => a.packetIndex - b.packetIndex);

      const data = Buffer.concat(sortedParts.map((part) => part.data));

      // TODO: Parse the command based on data.
      this.emit('message', data.toString());
    }
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
      const heartbeat = Packet.create(PacketTypes.Command, null, this._sequenceNumber++ % 256);
      this._socket.send(heartbeat.toBuffer());
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
  private _sendCommand(command: string) {
    if (!this._connected) return;
    const packet = Packet.create(PacketTypes.Command, Buffer.from(command), this._sequenceNumber++ % 256);

    this._waitingCommands.add(packet.sequence);

    this._socket.send(packet.toBuffer());

    // If the server does not respond within 5 seconds, abandon the command and cleanup.
    setTimeout(() => {
      if (!this._waitingCommands.has(packet.sequence)) return;

      this._commandPacketParts.delete(packet.sequence);
      this._waitingCommands.delete(packet.sequence);
    }, 5_000);
  }
}

export default Arcon;
