import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { readRequestBody } from "../src/runtime";

describe("ingestion-control Node request body", () => {
	it("reads a bounded request body", async () => {
		const request = requestStream();
		const reading = readRequestBody(request);
		request.end(Buffer.from("task"));

		await expect(reading).resolves.toEqual(Buffer.from("task"));
	});

	it("rejects a streamed request body larger than one MiB", async () => {
		const request = requestStream();
		const reading = readRequestBody(request);
		request.end(Buffer.alloc(1024 * 1024 + 1));

		await expect(reading).rejects.toThrow();
	});
});

function requestStream(): IncomingMessage & PassThrough {
	const request = new PassThrough() as IncomingMessage & PassThrough;
	request.headers = {};
	return request;
}
