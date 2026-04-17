import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const previewAllowedHosts = [
  'app.eeess.cyou',
  'crm.eeess.cyou',
  'manager.eeess.cyou',
  'eeess.cyou',
  'www.eeess.cyou',
];

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: false },
  preview: { host: '127.0.0.1', allowedHosts: previewAllowedHosts },
});
