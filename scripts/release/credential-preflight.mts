import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseWorkerCandidates, type WorkerCandidate } from "./workers.mts";

interface Status {
	id: number;
	context: string;
	state: string;
	description: string | null;
	creator?: { login: string };
}
const required: Record<WorkerCandidate, string[]> = {
	"app-api-staging": [
		"CLOUDFLARE_API_TOKEN",
		"APP_API_EXECUTION_SHARED_SECRET",
		"MEMORY_INTERNAL_SHARED_SECRET",
		"OPS_WEB_INTERNAL_TOKEN",
		"OBJECT_STORE_DERIVED_ACCESS_KEY",
		"OBJECT_STORE_DERIVED_SECRET_KEY",
		"OBJECT_STORE_DERIVED_READ_ACCESS_KEY",
		"OBJECT_STORE_DERIVED_READ_SECRET_KEY",
	],
	"campus-web-staging": [
		"CLOUDFLARE_API_TOKEN",
		"OBJECT_STORE_DERIVED_ACCESS_KEY",
		"OBJECT_STORE_DERIVED_SECRET_KEY",
		"OBJECT_STORE_DERIVED_READ_ACCESS_KEY",
		"OBJECT_STORE_DERIVED_READ_SECRET_KEY",
	],
	"status-web-staging": ["CLOUDFLARE_API_TOKEN"],
};
export function validateValues(workers: WorkerCandidate[], env: NodeJS.ProcessEnv): void {
	const missing = [...new Set(workers.flatMap((worker) => required[worker]))].filter(
		(name) => !env[name]?.trim(),
	);
	if (missing.length > 0) {
		throw new Error(`Missing Worker credentials: ${missing.join(", ")}`);
	}
}
export function assertDelivered(statuses: Status[]): void {
	const latest = statuses
		.filter(
			(status) =>
				status.context === "argocd-release/source-credentials-staging" &&
				status.creator?.login === "campus-agent-argocd[bot]",
		)
		.sort((a, b) => b.id - a.id)[0];
	if (latest?.state !== "success" || latest.description !== "source=none") {
		throw new Error(
			"Current GitOps credential delivery is not successful. Repair and sync source-credentials-staging, then rerun publication.",
		);
	}
}
export function preflight(): void {
	const workers = parseWorkerCandidates(process.env.WORKERS ?? "[]");
	validateValues(workers, process.env);
	if (!workers.some((worker) => worker !== "status-web-staging")) {
		return;
	}
	const api = (endpoint: string) =>
		JSON.parse(execFileSync("gh", ["api", endpoint], { encoding: "utf8" }));
	const repo = "MUC-WIKI/campus-agent-gitops";
	const main = api(`repos/${repo}/commits/main`) as { sha: string };
	if (!/^[0-9a-f]{40}$/.test(main.sha)) {
		throw new Error("Invalid GitOps revision");
	}
	const statuses: Status[] = [];
	for (let page = 1; ; page++) {
		const batch = api(
			`repos/${repo}/commits/${main.sha}/statuses?per_page=100&page=${page}`,
		) as Status[];
		statuses.push(...batch);
		if (batch.length < 100) {
			break;
		}
	}
	assertDelivered(statuses);
	if ((api(`repos/${repo}/commits/main`) as { sha: string }).sha !== main.sha) {
		throw new Error("GitOps changed during credential preflight; rerun publication.");
	}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		preflight();
	} catch (error) {
		console.error(error instanceof Error ? error.message : "Credential preflight failed");
		process.exitCode = 1;
	}
}
