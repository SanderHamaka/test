/**
 * The connection to the multiplayer relay (server/relay.js): joins a room, keeps the socket alive
 * with reconnects, and turns incoming messages into callbacks. Sending while offline does nothing.
 */
const RETRY_FIRST = 2000;
const RETRY_MAX = 30000;

/** Same host as the page (the relay runs on /relay), unless VITE_RELAY_URL says otherwise. */
export function relayUrl() {
  if (import.meta.env.VITE_RELAY_URL) return import.meta.env.VITE_RELAY_URL;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/relay`;
}

const ROOM_LETTERS = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes (l/1, o/0)

export function newRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => ROOM_LETTERS[b % ROOM_LETTERS.length]).join('');
}

/** A default name from the bird's species: "Gull-42". */
export function randomName(species) {
  const word = species.name.split(' ').pop();
  return `${word[0].toUpperCase()}${word.slice(1)}-${10 + Math.floor(Math.random() * 90)}`;
}

export class Net {
  /**
   * @param room     invite code
   * @param name     the name you'd like (the relay may add a number if it's taken)
   * @param species  species id, so the others can draw your bird
   * @param handlers { welcome, join, leave, s, env, name, race, finish, status } callbacks
   */
  constructor({ room, name, species, handlers, url = relayUrl() }) {
    this.room = room;
    this.name = name;
    this.species = species;
    this.handlers = handlers;
    this.url = url;
    this.id = null;
    this.status = 'connecting'; // 'connecting' | 'online' | 'offline'
    this.retry = RETRY_FIRST;
    this.closed = false;
    this.connect();
  }

  get online() {
    return this.status === 'online';
  }

  setStatus(status) {
    if (status === this.status) return;
    this.status = status;
    this.handlers.status?.(status);
  }

  connect() {
    if (this.closed) return;
    this.setStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = RETRY_FIRST;
      ws.send(JSON.stringify({ t: 'hello', room: this.room, name: this.name, species: this.species }));
    };
    ws.onmessage = (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'welcome') {
        this.id = msg.id;
        this.name = msg.name;
        this.setStatus('online');
      } else if (msg.t === 'renamed') {
        this.name = msg.name;
      }
      this.handlers[msg.t]?.(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.id = null;
      this.handlers.disconnect?.();
      this.setStatus('offline');
      this.scheduleRetry();
    };
  }

  scheduleRetry() {
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.connect(), this.retry);
    this.retry = Math.min(RETRY_MAX, this.retry * 1.6);
  }

  send(message) {
    if (this.ws?.readyState === WebSocket.OPEN && this.online) this.ws.send(JSON.stringify(message));
  }

  rename(name) {
    this.name = name;
    this.send({ t: 'name', name });
  }

  close() {
    this.closed = true;
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}
