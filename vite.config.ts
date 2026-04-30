import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS is required for WebXR on physical devices (Quest 3).
// On desktop you can access via http://localhost:5173 with a WebXR emulator extension.
export default defineConfig({
  plugins: [basicSsl()],
  server: {
    https: true,
    host: true, // expose on LAN so Quest can connect via your machine's IP
  },
});
