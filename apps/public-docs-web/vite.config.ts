import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { defineConfig } from "vite";

export default defineConfig({
	server: {
		host: "127.0.0.1",
		port: 5175,
		strictPort: true,
	},
	plugins: [
		mdx(await import("./source.config")),
		tailwindcss(),
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		tanstackStart({
			spa: {
				enabled: true,
				prerender: {
					crawlLinks: true,
				},
			},
		}),
		react(),
	],
	resolve: {
		tsconfigPaths: true,
		alias: {
			tslib: "tslib/tslib.es6.js",
		},
	},
});
