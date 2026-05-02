import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS is required for WebXR on physical devices (Quest 3).
// On desktop you can access via https://localhost:5173 with a WebXR emulator extension.
export default defineConfig(({ command }) => ({
  // Set base to repo name so asset paths work on GitHub Pages.
  // For local dev and self-hosted, override with VITE_BASE env var.
  base: process.env.VITE_BASE ?? (command === 'build' ? '/Xrcad/' : '/'),
  plugins: [basicSsl()],
  server: {
    host: true, // expose on LAN so Quest can connect via your machine's IP
  },
}));
