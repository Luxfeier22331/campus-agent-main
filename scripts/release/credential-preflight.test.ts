import assert from "node:assert/strict";
import test from "node:test";
import { assertDelivered, validateValues } from "./credential-preflight.mts";

const success = {
	id: 1,
	context: "argocd-release/source-credentials-staging",
	state: "success",
	description: "source=none",
	creator: { login: "campus-agent-argocd[bot]" },
};
test("accepts trusted success, rejects stale success and untrusted observations", () => {
	assertDelivered([success]);
	for (const state of ["pending", "failure", "error"]) {
		assert.throws(() => assertDelivered([success, { ...success, id: 2, state }]));
	}
	assert.throws(() => assertDelivered([{ ...success, creator: { login: "other" } }]));
	assert.throws(() => assertDelivered([{ ...success, description: "source=old" }]));
	assert.throws(() => assertDelivered([]));
});
test("only selected Worker credentials are required", () => {
	validateValues([], {});
	validateValues(["status-web-staging"], { CLOUDFLARE_API_TOKEN: "token" });
	assert.throws(
		() => validateValues(["campus-web-staging"], { CLOUDFLARE_API_TOKEN: "token" }),
		/OBJECT_STORE_DERIVED_READ/,
	);
	assert.throws(
		() => validateValues(["status-web-staging"], { CLOUDFLARE_API_TOKEN: " \n" }),
		/CLOUDFLARE_API_TOKEN/,
	);
});
