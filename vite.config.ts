import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages alt klasörde yayınladığı için göreli yol kullanıyoruz
  base: './',
  server: {
    // ngrok adreslerinden gelen isteklere izin ver
    allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io'],
  },
});
