import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:8080',
        changeOrigin: true,
      },
      '/auth': {
        target: process.env.VITE_AUTH_URL ?? 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
  build: {
    target:   'es2022',   // supports top-level await
    outDir:   'dist',
    sourcemap: false,
    // The charts chunk (ECharts core + 4 chart types, ~180 kB gzipped) loads after sign-in
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'query':        ['@tanstack/react-query'],
        },
      },
    },
  },
})
