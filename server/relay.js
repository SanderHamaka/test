/**
 * Birb multiplayer relay: groups players into rooms by invite code and forwards their messages.
 * It knows nothing about the world (every browser builds the place itself from OpenStreetMap);
 * it only remembers each player's latest state and the room's shared time and weather, so that
 * someone who joins can be placed and brought in step.
 *
 * Runs inside the Vite dev and preview servers (see vite.config.js) on the path /relay, or on its
 * own with `npm run relay` (PORT, default 8787) behind a web server that proxies /relay to it.
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

export const RELAY_PATH = '/relay';
const MAX_ROOM = 16;
const MAX_MESSAGE = 4096; // bytes; a race with its rings is the largest message
const HEARTBEAT_MS = 15000;

// Messages a player sends that are passed on to the rest of the room (with the sender's id added).
const FORWARD = new Set(['s', 'env', 'name', 'race', 'finish']);

const cleanName = (name) => String(name ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 20) || 'Bird';
const cleanRoom = (room) => (/^[a-z0-9]{4,12}$/.test(room) ? room : null);
const cleanSpecies = (species) => (/^[a-z-]{1,20}$/.test(species) ? species : 'gull');

export function createRelay({ log = console.log } = {}) {
  const rooms = new Map(); // code → { players: Map<id, player>, env }
  let nextId = 1;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE });

  const send = (ws, message) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(message));
  const broadcast = (room, message, exceptId) => {
    const text = JSON.stringify(message);
    for (const p of room.players.values()) if (p.id !== exceptId && p.ws.readyState === p.ws.OPEN) p.ws.send(text);
  };

  function uniqueName(room, name) {
    const taken = new Set([...room.players.values()].map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
  }

  wss.on('connection', (ws) => {
    let player = null;
    let room = null;
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (!player) {
        const code = msg.t === 'hello' && cleanRoom(msg.room);
        if (!code) return;
        room = rooms.get(code);
        if (!room) rooms.set(code, (room = { code, players: new Map(), env: null }));
        if (room.players.size >= MAX_ROOM) {
          ws.close(1013, 'room full');
          return;
        }
        player = { id: nextId++, ws, name: uniqueName(room, cleanName(msg.name)), species: cleanSpecies(msg.species), last: null };
        send(ws, {
          t: 'welcome',
          id: player.id,
          name: player.name,
          env: room.env,
          peers: [...room.players.values()].map(({ id, name, species, last }) => ({ id, name, species, last })),
        });
        broadcast(room, { t: 'join', id: player.id, name: player.name, species: player.species });
        room.players.set(player.id, player);
        log(`${new Date().toISOString()} ${player.name} joined room ${code} (${room.players.size} in room)`);
        return;
      }

      if (!FORWARD.has(msg.t)) return;
      if (msg.t === 's') player.last = msg;
      if (msg.t === 'env') {
        room.env = { offset: Number.isFinite(msg.offset) ? msg.offset : 0, wx: String(msg.wx ?? 'real').slice(0, 12) };
        msg = { t: 'env', ...room.env };
      }
      if (msg.t === 'name') {
        player.name = uniqueName(room, cleanName(msg.name));
        msg.name = player.name;
        send(ws, { t: 'renamed', name: player.name });
      }
      broadcast(room, { ...msg, id: player.id }, player.id);
    });

    ws.on('close', () => {
      if (!player) return;
      room.players.delete(player.id);
      broadcast(room, { t: 'leave', id: player.id });
      log(`${new Date().toISOString()} ${player.name} left room ${room.code} (${room.players.size} in room)`);
      if (!room.players.size) rooms.delete(room.code);
    });
  });

  // Drop connections that stopped answering (closed laptops, lost Wi-Fi).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);

  return {
    rooms,
    /** For an HTTP server's 'upgrade' event; returns false when the request is not for the relay. */
    handleUpgrade(req, socket, head) {
      if (new URL(req.url, 'http://x').pathname !== RELAY_PATH) return false;
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      return true;
    },
    close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}

// Standalone: `node server/relay.js` (or `npm run relay`).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT) || 8787;
  const relay = createRelay();
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`Birb relay: ${relay.rooms.size} rooms\n`);
  });
  server.on('upgrade', (req, socket, head) => {
    if (!relay.handleUpgrade(req, socket, head)) socket.destroy();
  });
  server.listen(port, () => console.log(`Birb relay listening on ws://localhost:${port}${RELAY_PATH}`));
}
