import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// We use a function to access environment variables during the build process
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, (process as any).cwd(), '');

  return {
    plugins: [react()],
    // IMPORTANT: './' ensures the app works on subpaths (like GitHub Pages) or root domains (Netlify)
    base: './', 
    define: {
      // This allows 'process.env' to be used in the browser code.
      // We explicitly map the variables we need.
      'process.env.API_KEY': JSON.stringify(env.API_KEY || process.env.API_KEY || ''),
      'process.env.REACT_APP_DB_URL': JSON.stringify(env.REACT_APP_DB_URL || process.env.REACT_APP_DB_URL || '')
    },
    build: {
      outDir: 'dist',
      sourcemap: false, // Disable source maps for production to save space
    }
  };
});