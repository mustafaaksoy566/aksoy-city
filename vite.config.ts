import { defineConfig, type Plugin } from 'vite';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Sadece geliştirirken: tarayıcıdaki şehri "hazır şehir" dosyası olarak kaydeder (public/ornek-sehir.txt).
// Yayındaki oyunda bu yol yoktur.
function demoCityWriter(): Plugin {
  return {
    name: 'demo-city-writer',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__hazir-sehir', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8').trim();
          if (!/^[A-Za-z0-9+/=]+$/.test(body)) {
            res.statusCode = 400;
            res.end('bad');
            return;
          }
          writeFileSync(resolve(__dirname, 'public/ornek-sehir.txt'), body + '\n');
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  // GitHub Pages alt klasörde yayınladığı için göreli yol kullanıyoruz
  base: './',
  plugins: [demoCityWriter()],
  server: {
    // ngrok adreslerinden gelen isteklere izin ver
    allowedHosts: ['.ngrok-free.app', '.ngrok.app', '.ngrok.io'],
  },
});
