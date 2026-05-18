import { describe, expect, it, vi } from "vitest";

import {
	type DocsVersionsResponse,
	fetchDocsVersionControlPayload,
} from "../src/reader/reader-version-controls";

describe("public docs reader version controls", () => {
	it("fails closed when the versions endpoint returns invalid JSON", async () => {
		const fetchImplementation = vi.fn(
			async () =>
				new Response("{", {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
		);

		await expect(
			fetchDocsVersionControlPayload({
				collection: "student_rules",
				corpus: "regulations",
				documentSlug: "student-card",
				fetchImplementation,
			}),
		).rejects.toThrow("Docs versions endpoint returned invalid JSON.");
	});

	it("requires a typed versions array from the versions endpoint", async () => {
		const fetchImplementation = vi.fn(
			async () =>
				new Response(JSON.stringify({ versions: [{ label: "current" }] }), {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
		);

		await expect(
			fetchDocsVersionControlPayload({
				collection: "student_rules",
				corpus: "regulations",
				documentSlug: "student-card",
				fetchImplementation,
			}),
		).rejects.toThrow("Docs versions endpoint returned an invalid payload.");
	});

	it("returns typed version payloads without changing valid data", async () => {
		const payload: DocsVersionsResponse = {
			versions: [
				{ isCurrent: true, label: "当前版本", versionSlug: "current" },
				{ isCurrent: false, label: "2025", versionSlug: "2025" },
			],
		};
		const fetchImplementation = vi.fn(
			async () =>
				new Response(JSON.stringify(payload), {
					headers: { "content-type": "application/json" },
					status: 200,
				}),
		);

		await expect(
			fetchDocsVersionControlPayload({
				collection: "student_rules",
				corpus: "regulations",
				documentSlug: "student-card",
				fetchImplementation,
			}),
		).resolves.toEqual(payload);
	});
});
