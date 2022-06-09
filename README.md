# ARCON.js [![](https://img.shields.io/npm/v/arcon.js?maxAge=3600)](https://npmjs.com/package/arcon.js) [![install size](https://packagephobia.com/badge?p=arcon.js)](https://packagephobia.com/result?p=arcon.js) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

ARCON.js is a lightweight RCON client for Arma III servers.

## Usage

```ts
import arcon from 'arcon.js';

const connection = new arcon({
  ip: '127.0.0.1',
  port: 2312,
  password: '12345'
});

connection.on('connected', async () => {
  await connection.commands.players();
  await connection.commands.sayGlobal('RCON is working!');
});

connection.connect();
```
