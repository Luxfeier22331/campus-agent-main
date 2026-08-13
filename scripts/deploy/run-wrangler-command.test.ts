import assert from "node:assert/strict";
import test from "node:test";

import { main } from "./run-wrangler-command.ts";

test("rejects --cwd without a directory before running Wrangler", (context) => {
	const messages: string[] = [];
	context.mock.method(console, "error", (...args: unknown[]) => {
		messages.push(args.join(" "));
	});

	assert.equal(main(["--cwd"]), 1);
	assert.deepEqual(messages, [
		"Usage: pnpm exec tsx scripts/deploy/run-wrangler-command.ts [--cwd <dir>] <wrangler-args...>",
	]);
});
