import assert from "node:assert/strict";
import test from "node:test";
import { wrapMaintenance } from "./wrapper.mjs";

function fixture(mode) {
	const calls = [];
	const original = {
		fetch(request, env) {
			calls.push({ path: new URL(request.url).pathname, env });
			return new Response("ok");
		},
		scheduled(_, env) {
			calls.push({ env });
		},
	};
	return { calls, worker: wrapMaintenance(original, mode) };
}
test("drain permits completion and cancellation but rejects new execution and destructive chat changes", async () => {
	const { worker, calls } = fixture("drain");
	for (const [path, method, status] of [
		["/api/account/delete", "POST", 503],
		["/api/chat/requests", "POST", 503],
		["/api/chat/conversations/x", "DELETE", 503],
		["/api/chat/requests/x/events/stream", "GET", 200],
		["/api/chat/requests/x/cancel", "POST", 200],
		["/api/internal/agent/runs/x/product-finalization", "PUT", 200],
	]) {
		assert.equal(
			(await worker.fetch(new Request(`https://api.test${path}`, { method }), {}, {})).status,
			status,
		);
	}
	assert(calls.every(({ env }) => env.EXECUTION_MAINTENANCE === "true"));
});
test("frozen never enters execution handlers but preserves unrelated APIs and scheduled work", async () => {
	const { worker, calls } = fixture("frozen");
	for (const path of [
		"/api/chat/requests/x",
		"/api/history",
		"/api/me/profile-memory",
		"/api/internal/admin/chat-conversations",
		"/api/internal/agent/runs/x/input",
	]) {
		assert.equal((await worker.fetch(new Request(`https://api.test${path}`), {}, {})).status, 503);
	}
	assert.equal(calls.length, 0);
	assert.equal(
		(await worker.fetch(new Request("https://api.test/api/dining"), {}, {})).status,
		200,
	);
	await worker.scheduled({}, { EDGE_INGRESS_SHARED_SECRET: "original", OTHER: "preserved" }, {});
	assert.equal(calls.at(-1).env.EDGE_INGRESS_SHARED_SECRET, "");
	assert.equal(calls.at(-1).env.OTHER, "preserved");
});
test("verify allows internal callbacks only; invalid modes fail before wrapping", async () => {
	const { worker } = fixture("verify");
	assert.equal(
		(
			await worker.fetch(
				new Request("https://api.test/api/internal/profile-memory/commands/x/result", {
					method: "PUT",
				}),
				{},
				{},
			)
		).status,
		200,
	);
	assert.equal(
		(
			await worker.fetch(
				new Request("https://api.test/api/chat/requests", { method: "POST" }),
				{},
				{},
			)
		).status,
		503,
	);
	assert.throws(() => wrapMaintenance({}, "normal"));
});
