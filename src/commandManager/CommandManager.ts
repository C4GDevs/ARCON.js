import ARCon from '../client';

export default class CommandManager {
  private _arcon: ARCon;

  constructor(arcon: ARCon) {
    this._arcon = arcon;
  }

  addBan = (identifier: string, time = -1, reason?: string) => {
    if (!/^[a-z0-9]{32}$/.test(identifier) && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(identifier))
      throw new Error('Invalid player identifier');

    let input = `addBan ${identifier} ${time}`;
    if (reason) input += ` ${reason};`;
    this._arcon.send(input);
  };

  admins = () => {
    this._arcon.send('admins');
  };

  bans = () => {
    this._arcon.send('writeBans');
  };

  loadBans = () => {
    this._arcon.send('loadBans');
  };

  loadEvents = () => {
    this._arcon.send('loadEvents');
  };

  loadScripts = () => {
    this._arcon.send('loadScripts');
  };

  missions = () => {
    this._arcon.send('missions');
  };

  removeBan = (id: number) => {
    this._arcon.send(`removeBan ${id}`);
  };

  sayGlobal = (message: string) => {
    this._arcon.send(`say -1 ${message}`);
  };

  writeBans = () => {
    this._arcon.send('writeBans');
  };
}
