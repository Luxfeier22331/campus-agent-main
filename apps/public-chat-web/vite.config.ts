import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const liveSmokeAppApiEnvPath = path.resolve(__dirname, "../app-api/.env");
const liveSmokeAppApiConfigPath = path.resolve(__dirname, "../app-api/wrangler.local-smoke.toml");
const useLiveSmokeAuxiliaryWorker = process.env.PUBLIC_CHAT_LIVE_SMOKE === "1";

if (useLiveSmokeAuxiliaryWorker) {
  try {
    process.loadEnvFile(liveSmokeAppApiEnvPath);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function normalizeImporter(importer: string | undefined) {
  return importer?.replace(/\\/g, "/");
}

function createVendorCompatResolver(): Plugin {
  const vendorArtifactActionsPath = "/vendor/vercel-ai-chatbot/artifacts/actions.ts";
  const vendorCodeBlockPath = "/vendor/vercel-ai-chatbot/components/ai-elements/code-block.tsx";
  const vendorDbQueriesPath = normalizeImporter(
    path.resolve(__dirname, "vendor/vercel-ai-chatbot/lib/db/queries.ts"),
  );
  const compatDbQueriesPath = path.resolve(
    __dirname,
    "src/platform/vendor-compat/lib/db/queries.ts",
  );
  const compatShikiPath = path.resolve(__dirname, "src/platform/vendor-compat/shiki.ts");

  return {
    enforce: "pre",
    name: "vendor-compat-resolver",
    resolveId(source, importer) {
      const normalizedImporter = normalizeImporter(importer);

      if (
        (source === "@/lib/db/queries" || normalizeImporter(source) === vendorDbQueriesPath) &&
        normalizedImporter?.endsWith(vendorArtifactActionsPath)
      ) {
        return compatDbQueriesPath;
      }

      if (source === "shiki" && normalizedImporter?.endsWith(vendorCodeBlockPath)) {
        return compatShikiPath;
      }

      return null;
    },
  };
}

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
  plugins: [
    createVendorCompatResolver(),
    tailwindcss(),
    react(),
    cloudflare({
      ...(useLiveSmokeAuxiliaryWorker
        ? {
            auxiliaryWorkers: [
              {
                configPath: liveSmokeAppApiConfigPath,
              },
            ],
            inspectorPort: false,
          }
        : {}),
    }),
  ],
  resolve: {
    alias: [
      {
        find: /^@\/lib\/db\/queries$/,
        replacement: path.resolve(__dirname, "vendor/vercel-ai-chatbot/lib/db/queries.ts"),
      },
      {
        find: /^@\/lib\/ai\/models$/,
        replacement: path.resolve(__dirname, "src/platform/vendor-compat/lib/ai/models.ts"),
      },
      {
        find: /^@\/lib\/constants$/,
        replacement: path.resolve(__dirname, "src/platform/vendor-compat/lib/constants.ts"),
      },
      {
        find: /^@\/lib\/db\/schema$/,
        replacement: path.resolve(__dirname, "src/platform/vendor-compat/lib/db/schema.ts"),
      },
      {
        find: /^@\/lib\/editor\/diff$/,
        replacement: path.resolve(__dirname, "src/platform/vendor-compat/lib/editor/diff.ts"),
      },
      {
        find: /^@\/lib\/types$/,
        replacement: path.resolve(__dirname, "src/platform/vendor-compat/lib/types.ts"),
      },
      {
        find: /^@\/lib\/utils$/,
        replacement: path.resolve(__dirname, "src/platform/vendor-compat/lib/utils.ts"),
      },
      {
        find: /^next\/link$/,
        replacement: path.resolve(__dirname, "src/platform/vendor-compat/next/link.tsx"),
      },
      {
        find: /^next\/navigation$/,
        replacement: path.resolve(__dirname, "src/platform/vendor-compat/next/navigation.ts"),
      },
      {
        find: /^next\/image$/,
        replacement: path.resolve(__dirname, "src/platform/vendor-compat/next/image.tsx"),
      },
      {
        find: /^next-auth\/react$/,
        replacement: path.resolve(__dirname, "src/platform/vendor-compat/next-auth/react.tsx"),
      },
      {
        find: /^next-auth$/,
        replacement: path.resolve(__dirname, "src/platform/vendor-compat/next-auth/index.ts"),
      },
      {
        find: /^@streamdown\/code$/,
        replacement: path.resolve(__dirname, "src/platform/vendor-compat/streamdown/code.ts"),
      },
      {
        find: /^@\/app\/\(chat\)\/actions$/,
        replacement: path.resolve(__dirname, "src/platform/vendor-compat/app/chat-actions.ts"),
      },
      {
        find: /^@\/hooks\/use-active-chat$/,
        replacement: path.resolve(
          __dirname,
          "src/platform/vendor-compat/hooks/use-active-chat.ts",
        ),
      },
      {
        find: /^@\/hooks\/use-chat-visibility$/,
        replacement: path.resolve(
          __dirname,
          "src/platform/vendor-compat/hooks/use-chat-visibility.ts",
        ),
      },
      {
        find: "@/components/ai-elements",
        replacement: path.resolve(__dirname, "vendor/vercel-ai-chatbot/components/ai-elements"),
      },
      {
        find: "@/components/chat/icons",
        replacement: path.resolve(__dirname, "vendor/vercel-ai-chatbot/components/chat/icons.tsx"),
      },
      {
        find: "@/components/chat/toast",
        replacement: path.resolve(__dirname, "vendor/vercel-ai-chatbot/components/chat/toast.tsx"),
      },
      {
        find: "@/components/theme-provider",
        replacement: path.resolve(__dirname, "vendor/vercel-ai-chatbot/components/theme-provider.tsx"),
      },
      {
        find: "@/components/ui",
        replacement: path.resolve(__dirname, "vendor/vercel-ai-chatbot/components/ui"),
      },
      {
        find: "@/hooks/use-mobile",
        replacement: path.resolve(__dirname, "vendor/vercel-ai-chatbot/hooks/use-mobile.ts"),
      },
      {
        find: "@/hooks/use-scroll-to-bottom",
        replacement: path.resolve(
          __dirname,
          "vendor/vercel-ai-chatbot/hooks/use-scroll-to-bottom.tsx",
        ),
      },
      {
        find: "@",
        replacement: path.resolve(__dirname, "vendor/vercel-ai-chatbot"),
      },
      {
        find: "@platform",
        replacement: path.resolve(__dirname, "src/platform"),
      },
    ],
  },
});
