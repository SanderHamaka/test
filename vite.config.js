import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createRelay } from './server/relay.js';

/** Runs the multiplayer relay inside the dev and preview servers, on /relay. */
function relay() {
  const attach = (server) => {
    if (!server.httpServer) return;
    const instance = createRelay();
    server.httpServer.on('upgrade', (req, socket, head) => instance.handleUpgrade(req, socket, head));
    server.httpServer.on('close', () => instance.close());
  };
  return { name: 'birb-relay', configureServer: attach, configurePreviewServer: attach };
}

export default defineConfig({
  plugins: [svelte(), relay()],
});
