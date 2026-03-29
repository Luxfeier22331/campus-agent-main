import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { protectedPanelManualChunks } from "./config/manual-chunks";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: protectedPanelManualChunks,
      },
    },
  },
  plugins: [react(), cloudflare()],
});
