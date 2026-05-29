import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'https://crypto-signal-bot-deqd.onrender.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': {
        target: (process.env.VITE_BACKEND_URL || 'https://crypto-signal-bot-deqd.onrender.com').replace(/^http/, 'ws'),
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@supabase/supabase-js")) {
              return "supabase-auth";
            }
            if (id.includes("recharts")) {
              return "dashboard-charts";
            }
            if (
              id.includes("@tanstack/react-query") ||
              id.includes("react-router-dom") ||
              id.includes("react-dom") ||
              id.includes("/react/")
            ) {
              return "app-core";
            }
            if (
              id.includes("@radix-ui") ||
              id.includes("lucide-react") ||
              id.includes("sonner") ||
              id.includes("class-variance-authority") ||
              id.includes("tailwind-merge") ||
              id.includes("embla-carousel-react") ||
              id.includes("react-day-picker") ||
              id.includes("react-resizable-panels") ||
              id.includes("cmdk") ||
              id.includes("vaul")
            ) {
              return "ui-vendor";
            }
          }

          if (id.includes("/src/pages/Index") || id.includes("/src/components/dashboard/")) {
            return "dashboard-route";
          }
        },
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
