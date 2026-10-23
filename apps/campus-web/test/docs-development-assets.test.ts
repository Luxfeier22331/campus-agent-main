// @vitest-environment node

import { describe, expect, it } from "vitest";

import { serveDocsDevelopmentAsset } from "../vite.config.ts";

describe("docs development assets", () => {
	it("terminates missing docs asset requests with a real 404", () => {
		for (const method of ["GET", "HEAD"] as const) {
			const headers = new Map<string, string>();
			let body: Uint8Array | undefined;
			const response = {
				end(chunk?: Uint8Array) {
					body = chunk;
				},
				setHeader(name: string, value: string) {
					headers.set(name, value);
				},
				statusCode: 200,
			};

			expect(
				serveDocsDevelopmentAsset({
					publicRoot: "/tmp/campus-web-missing-docs-assets",
					request: { method },
					response,
					url: new URL("http://campus.local/_docs/missing.json"),
				}),
			).toBe(true);
			expect(response.statusCode).toBe(404);
			expect(headers.get("content-type")).toBe("text/plain; charset=utf-8");
			expect(method === "HEAD" ? body : new TextDecoder().decode(body)).toBe(
				method === "HEAD" ? undefined : "Not Found",
			);
		}
	});
});
