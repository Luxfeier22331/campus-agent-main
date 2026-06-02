import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const liveSmokeAppApiEnvPath = path.resolve(__dirname, "../app-api/.env");
const liveSmokeAppApiConfigPath = path.resolve(__dirname, "../app-api/wrangler.local-smoke.toml");
const liveSmokeAuthShellOrigin = "http://127.0.0.1:27012";
const liveSmokeHubConfigPath = path.resolve(__dirname, "wrangler.local-smoke.toml");
const useLiveSmokeAuxiliaryWorker = process.env.HUB_LIVE_SMOKE === "1";

if (useLiveSmokeAuxiliaryWorker) {
	try {
		process.loadEnvFile(liveSmokeAppApiEnvPath);
	} catch (error) {
		if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
			throw error;
		}
	}
}

export default defineConfig({
	publicDir: path.resolve(__dirname, "../../configs/branding/web-public"),
	plugins: [
		tailwindcss(),
		react(),
		cloudflare({
			inspectorPort: false,
			...(useLiveSmokeAuxiliaryWorker
				? {
						auxiliaryWorkers: [
							{
								configPath: liveSmokeAppApiConfigPath,
								config: (config) => ({
									vars: {
										...(config.vars ?? {}),
										AUTH_SHELL_ORIGIN: liveSmokeAuthShellOrigin,
									},
								}),
							},
						],
						configPath: liveSmokeHubConfigPath,
					}
				: {}),
		}),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
});
