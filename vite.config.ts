import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverPort = Number(process.env.VITE_SERVER_PORT || 5300);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/ws': {
        target: `http://127.0.0.1:${serverPort}`,
        ws: true,
        changeOrigin: false,
      },
      '/api': {
        target: `http://127.0.0.1:${serverPort}`,
        changeOrigin: false,
      },
    },
  },
});
