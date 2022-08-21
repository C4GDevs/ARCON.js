# ARCON.js [![](https://img.shields.io/npm/v/arcon.js?maxAge=3600)](https://npmjs.com/package/arcon.js) [![install size](https://packagephobia.com/badge?p=arcon.js)](https://packagephobia.com/result?p=arcon.js) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Tests](https://github.com/C4GDevs/ARCON.js/actions/workflows/test.yml/badge.svg?branch=v2.x&event=release)](https://github.com/C4GDevs/ARCON.js/actions/workflows/test.yml)

ARCON.js is a lightweight RCON client for Arma III servers.

## Usage

```ts
import Arcon from 'arcon.js';

const connection = new Arcon({
  ip: '127.0.0.1',
  port: 2312,
  password: '12345'
});

connection.on('connected', async () => {
  const target = connection.playerManager.resolve(15);
  connection.playerManager.kick(target, 'testing');
});

connection.connect();
```
