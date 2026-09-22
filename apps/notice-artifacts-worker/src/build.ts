import { build } from "esbuild";

await build({
	entryPoints: ["src/worker.ts"],
	outdir: "dist",
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node24",
	external: ["@temporalio/*", "@aws-sdk/*", "pg"],
});
