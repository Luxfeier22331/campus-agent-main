import assert from "node:assert/strict";
import test from "node:test";

import {
	parseWorkerCandidates,
	WORKER_CANDIDATES,
	workerCandidatesForPackage,
	workerInstallFilters,
} from "./workers.mts";

test("worker candidates have one package and install-filter registry", () => {
	assert.deepEqual(WORKER_CANDIDATES, [
		"app-api-staging",
		"campus-web-staging",
		"edge-router-staging",
		"status-web-staging",
	]);
	assert.deepEqual(workerCandidatesForPackage("campus-web"), ["campus-web-staging"]);
	assert.deepEqual(workerCandidatesForPackage("unknown"), []);
	assert.deepEqual(workerInstallFilters(["app-api-staging", "campus-web-staging"]), [
		"campus-agent-web-workspace",
		"campus-contracts...",
		"app-api...",
		"campus-web...",
	]);
});

test("worker selection rejects malformed, unsupported, and duplicate input", () => {
	assert.throws(() => parseWorkerCandidates("{}"), /JSON array/u);
	assert.throws(() => parseWorkerCandidates('["unknown"]'), /Unsupported Worker candidate/u);
	assert.throws(
		() => parseWorkerCandidates('["app-api-staging","app-api-staging"]'),
		/must be unique/u,
	);
	assert.deepEqual(parseWorkerCandidates('["status-web-staging"]'), ["status-web-staging"]);
});
