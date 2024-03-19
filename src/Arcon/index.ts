import { EventEmitter } from 'events';
import { createSocket, Socket } from 'dgram';
import { SequencePacket, createPacket, Packet, PacketError, PacketTypes } from './packet';

interface ClientOptions {
  /** Host of the RCON server. */
  host: string;
  /** Port of the RCON server. */
  port: number;
  /** The password of the RCON server. */
  password: string;
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

  private _host: string;
  private _port: number;
  private _password: string;

  private _loginTimeout: NodeJS.Timeout;

  /**
   * @param options - The options for the ARCON instance.
   */
  constructor({ host, port, password }: ClientOptions) {
    super();

    this._host = host;
    this._port = port;
    this._password = password;

    setInterval(() => this._heartbeat(), 1000);
  }

  /**
   * Opens a socket to the server and login.
   */
  connect() {
    if (this._connected) return;
    this._socket = createSocket('udp4');

    this._socket.on('message', (buf) => this._handleMessage(buf));

    const loginPacket = Packet.create(PacketTypes.Login, Buffer.from(this._password));

    // Server is unreachable if it does not respond within 5 seconds.
    this._loginTimeout = setTimeout(() => {
      this.emit('error', new Error('Login timeout'));
      this.close();
    }, 5000);

    this._socket.connect(this._port, this._host, () => {
      this._socket.send(loginPacket.toBuffer());
    });
  }

  /**
   * Closes the socket to the server.
   * @param emit Whether to emit the `disconnected` event.
   */
  close(emit: boolean = true) {
    this._socket.close();
    this._connected = false;

    // Reset the sequence number incase we reconnect.
    this._sequenceNumber = 0;

    if (emit) this.emit('disconnected');
  }

  /**
   * Determines whether the login was successful.
   * @param packet The parsed packet from the server.
   */
  private _handleLogin(packet: Packet) {
    clearTimeout(this._loginTimeout);

    // Password in incorrect.
    if (packet.data.toString() === '0') {
      this.emit('error', new Error('Login failed'));
      this.close(false);
      return;
    }

    this._connected = true;
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
    if (packet instanceof Packet) return this._handleLogin(packet);

    this._lastPacketReceivedAt = new Date();

    // All server messages require a response.
    if (packet.type === PacketTypes.Message) {
      const response = SequencePacket.create(PacketTypes.Message, null, packet.sequence);

      this._socket.send(response.toBuffer());

      // TODO: Parse the message based on data.
      this.emit('message', packet);
      return;
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
      this.close();
      return;
    }

    // Send a heartbeat packet every 2.5 seconds.
    if (delta > 2_500) {
      const heartbeat = SequencePacket.create(PacketTypes.Command, null, this._sequenceNumber++ % 256);
      this._socket.send(heartbeat.toBuffer());
    }
  }
}

export default Arcon;
