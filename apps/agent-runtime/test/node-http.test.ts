import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { nodeClientDisconnectSignal } from "../src/node-http.ts";

describe("agent runtime node HTTP bridge", () => {
	it("does not abort the web request signal when the incoming request closes normally", () => {
		const request = new EventEmitter();
		const response = new EventEmitter();

		const signal = nodeClientDisconnectSignal(request, response);

		expect(signal.aborted).toBe(false);

		request.emit("close");

		expect(signal.aborted).toBe(false);
	});

	it("aborts the web request signal when the incoming request is aborted", () => {
		const request = new EventEmitter();
		const response = new EventEmitter();

		const signal = nodeClientDisconnectSignal(request, response);

		request.emit("aborted");

		expect(signal.aborted).toBe(true);
	});

	it("aborts the web request signal when the response closes before completion", () => {
		const request = new EventEmitter();
		const response = new EventEmitter();

		const signal = nodeClientDisconnectSignal(request, response);

		response.emit("close");

		expect(signal.aborted).toBe(true);
	});
});
