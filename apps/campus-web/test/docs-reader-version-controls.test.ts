import { describe, expect, it, vi } from "vitest";

import {
	type DocsVersionsResponse,
	fetchDocsVersionControlPayload,
} from "../src/docs/reader/reader-version-controls";

describe("campus docs reader version controls", () => {
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
		).rejects.toThrow("文档版本信息暂不可用。");
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
		).rejects.toThrow("文档版本信息暂不可用。");
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
