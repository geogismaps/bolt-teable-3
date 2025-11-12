import { defineConfig } from 'vite';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        login: resolve(__dirname, 'public/login.html'),
        dashboard: resolve(__dirname, 'public/dashboard.html'),
        map: resolve(__dirname, 'public/map.html'),
        table: resolve(__dirname, 'public/table.html'),
        users: resolve(__dirname, 'public/users.html'),
        permissions: resolve(__dirname, 'public/permissions.html'),
        logs: resolve(__dirname, 'public/logs.html'),
        config: resolve(__dirname, 'public/config.html'),
        mapConfig: resolve(__dirname, 'public/map-config.html'),
        publicMap: resolve(__dirname, 'public/public-map.html'),
        superAdmin: resolve(__dirname, 'public/super-admin.html'),
        teableViewMap: resolve(__dirname, 'public/teable-view-based-map.html')
      }
    }
  },
  server: {
    port: 5000,
    host: '0.0.0.0',
    open: '/login.html',
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false
      }
    }
  }
});
