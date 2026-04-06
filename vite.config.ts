import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
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
