import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	publicDir: path.resolve(__dirname, "../../configs/branding/web-public"),
	plugins: [
		tailwindcss(),
		react(),
		cloudflare({
			inspectorPort: false,
		}),
	],
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "src"),
		},
	},
});
