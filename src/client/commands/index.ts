import Connection from '../Connection';

class CommandManager {
  private readonly _connection: Connection;

  constructor(connection: Connection) {
    this._connection = connection;
  }

  public addBan(id: string, time = -1, reason: string) {
    return this._connection.sendCommand('addBan', id, time, reason);
  }

  public admins() {
    return this._connection.sendCommand('admins');
  }

  public kick(player: number, reason: string | null = null) {
    return this._connection.sendCommand('kick', player, reason);
  }

  public loadBans() {
    return this._connection.sendCommand('loadBans');
  }

  public loadEvents() {
    return this._connection.sendCommand('loadEvents');
  }

  public loadScripts() {
    return this._connection.sendCommand('loadScripts');
  }

  public lock() {
    return this._connection.sendCommand('#lock');
  }

  public players() {
    return this._connection.sendCommand('players');
  }

  public sayGlobal(message: string) {
    return this._connection.sendCommand('say', -1, message);
  }

  public sayPlayer(player: number, message: string) {
    return this._connection.sendCommand('say', player, message);
  }

  public shutdown() {
    return this._connection.sendCommand('shutdown');
  }

  public unlock() {
    return this._connection.sendCommand('#unlock');
  }

  public reassign() {
    return this._connection.sendCommand('#reassign');
  }

  public removeBan(id: number) {
    return this._connection.sendCommand('removeBan', id);
  }

  public restartServer(waitForMissionEnd: boolean) {
    return this._connection.sendCommand(waitForMissionEnd ? '#restartserveraftermission' : '#restartserver');
  }

  public writeBans() {
    return this._connection.sendCommand('writeBans');
  }
}

export = CommandManager;
