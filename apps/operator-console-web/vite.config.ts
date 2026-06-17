import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { operatorConsoleManualChunks } from "./config/manual-chunks";

const liveSmokePanelConfigPath = path.resolve(__dirname, "wrangler.local-smoke.toml");
const liveSmokeAppApiEnvPath = path.resolve(__dirname, "../app-api/.env");
const liveSmokeAppApiConfigPath = path.resolve(__dirname, "../app-api/wrangler.local-smoke.toml");
const liveSmokeExecutionControlBaseUrl = "http://127.0.0.1:27051";
const useLiveSmokeAuxiliaryWorker = process.env.OPERATOR_CONSOLE_LIVE_SMOKE === "1";

if (useLiveSmokeAuxiliaryWorker) {
	try {
		process.loadEnvFile(liveSmokeAppApiEnvPath);
	} catch (error) {
		if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
			throw error;
		}
	}
	process.env.EXECUTION_CONTROL_BASE_URL = liveSmokeExecutionControlBaseUrl;
}

export default defineConfig({
	build: {
		rollupOptions: {
			output: {
				manualChunks: operatorConsoleManualChunks,
			},
		},
	},
	publicDir: path.resolve(__dirname, "../../configs/branding/web-public"),
	plugins: [
		tailwindcss(),
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
