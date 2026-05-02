import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { protectedPanelManualChunks } from "./config/manual-chunks";

const liveSmokePanelConfigPath = path.resolve(__dirname, "wrangler.local-smoke.toml");
const liveSmokeAppApiEnvPath = path.resolve(__dirname, "../app-api/.env");
const liveSmokeAppApiConfigPath = path.resolve(__dirname, "../app-api/wrangler.local-smoke.toml");
const liveSmokeSupervisorApiBaseUrl = "http://127.0.0.1:27051";
const useLiveSmokeAuxiliaryWorker = process.env.PANEL_LIVE_SMOKE === "1";

if (useLiveSmokeAuxiliaryWorker) {
	try {
		process.loadEnvFile(liveSmokeAppApiEnvPath);
	} catch (error) {
		if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
			throw error;
		}
	}
	process.env.SUPERVISOR_API_BASE_URL = liveSmokeSupervisorApiBaseUrl;
}

export default defineConfig({
	build: {
		rollupOptions: {
			output: {
				manualChunks: protectedPanelManualChunks,
			},
		},
	},
	plugins: [
		react(),
		cloudflare({
			...(useLiveSmokeAuxiliaryWorker
				? {
						configPath: liveSmokePanelConfigPath,
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
});
