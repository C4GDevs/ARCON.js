import ARCon from '../client';

export default class CommandManager {
  private _arcon: ARCon;

  constructor(arcon: ARCon) {
    this._arcon = arcon;
  }

  sayGlobal = (message: string) => {
    this._arcon.send(`say -1 ${message}`);
  };
}
