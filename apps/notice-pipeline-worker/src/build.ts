import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { bundleWorkflowCode } from "@temporalio/worker";
import { build } from "esbuild";

await mkdir("dist", { recursive: true });
const bundle = await bundleWorkflowCode({
	workflowsPath: fileURLToPath(new URL("./workflows.ts", import.meta.url)),
});
await writeFile("dist/workflows.cjs", bundle.code);
await build({
	entryPoints: ["src/worker.ts", "src/schedule-cli.ts"],
	outdir: "dist",
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	external: [
		"@temporalio/*",
		"@aws-sdk/*",
		"content-disposition",
		"dotenv",
		"jsdom",
		"mime-types",
		"pg",
		"tldts",
		"undici",
	],
});
