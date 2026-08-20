import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ENTRYPOINTS = ["server.js", "migrate.js", "schema-bootstrap.js", "internal-portal-check.js"];

export async function checkProductionArtifact(distRoot = resolve(import.meta.dirname, "../dist")) {
	for (const entrypoint of ENTRYPOINTS) {
		await access(join(distRoot, entrypoint));
	}

	await import(pathToFileURL(join(distRoot, "internal-portal-check.js")).href);
	return { entrypoints: ENTRYPOINTS.length };
}

function errorCode(error) {
	if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
		return error.code;
	}
	if (error instanceof Error && error.message.includes("Dynamic require")) {
		return "dynamic_require_unsupported";
	}
	return "production_artifact_check_failed";
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
	checkProductionArtifact()
		.then(({ entrypoints }) => {
			console.log(
				JSON.stringify({
					entrypoints,
					event_type: "ingestion_control.production_artifact_check",
					status: "passed",
				}),
			);
		})
		.catch((error) => {
			console.error(
				JSON.stringify({
					error_code: errorCode(error),
					event_type: "ingestion_control.production_artifact_check",
					message: error instanceof Error ? error.message : String(error),
					status: "failed",
				}),
			);
			process.exitCode = 1;
		});
}
