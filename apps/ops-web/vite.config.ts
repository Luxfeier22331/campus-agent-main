import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	build: {
		rollupOptions: {
			output: {
				manualChunks: opsWebManualChunks,
			},
		},
	},
	plugins: [tailwindcss(), react()],
	server: {
		proxy: {
			"/api": {
				target: "http://127.0.0.1:5178",
				changeOrigin: false,
			},
		},
	},
	ssr: {
		noExternal: [
			"@campus-agent/dining",
			"@campus-agent/langfuse-identity",
			"@campus-agent/ui",
			"fast-xml-parser",
		],
	},
});

function opsWebManualChunks(id: string): string | undefined {
	if (!id.includes("/node_modules/")) {
		return;
	}
	if (id.includes("/@tanstack/")) {
		return "vendor-tanstack";
	}
	if (id.includes("/react/") || id.includes("/react-dom/")) {
		return "vendor-react";
	}
	if (id.includes("/lucide-react/")) {
		return "vendor-icons";
	}
	if (id.includes("/zod/")) {
		return "vendor-validation";
	}
	return "vendor";
}
