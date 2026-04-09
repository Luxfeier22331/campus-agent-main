import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "process.env.CI_PLAYWRIGHT": JSON.stringify(process.env.CI_PLAYWRIGHT ?? ""),
    "process.env.NEXT_PUBLIC_BASE_PATH": JSON.stringify(""),
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "development"),
    "process.env.PLAYWRIGHT": JSON.stringify(process.env.PLAYWRIGHT ?? ""),
    "process.env.PLAYWRIGHT_TEST_BASE_URL": JSON.stringify(
      process.env.PLAYWRIGHT_TEST_BASE_URL ?? "",
    ),
  },
  plugins: [tailwindcss(), react(), cloudflare()],
  resolve: {
    alias: {
      "@/components/ai-elements": path.resolve(
        __dirname,
        "vendor/vercel-ai-chatbot/components/ai-elements",
      ),
      "@/components/chat/icons": path.resolve(
        __dirname,
        "vendor/vercel-ai-chatbot/components/chat/icons.tsx",
      ),
      "@/components/chat/toast": path.resolve(
        __dirname,
        "vendor/vercel-ai-chatbot/components/chat/toast.tsx",
      ),
      "@/components/theme-provider": path.resolve(
        __dirname,
        "vendor/vercel-ai-chatbot/components/theme-provider.tsx",
      ),
      "@/components/ui": path.resolve(__dirname, "vendor/vercel-ai-chatbot/components/ui"),
      "@/hooks/use-mobile": path.resolve(
        __dirname,
        "vendor/vercel-ai-chatbot/hooks/use-mobile.ts",
      ),
      "@/hooks/use-scroll-to-bottom": path.resolve(
        __dirname,
        "vendor/vercel-ai-chatbot/hooks/use-scroll-to-bottom.tsx",
      ),
      "@": path.resolve(__dirname, "vendor/vercel-ai-chatbot"),
      "@platform": path.resolve(__dirname, "src/platform"),
    },
  },
});
