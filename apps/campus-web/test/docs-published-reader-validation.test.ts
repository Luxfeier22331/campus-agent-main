import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { checkCampusPublishedReaderInputs } from "../scripts/sync-campus-published-reader.mjs";
import {
	cleanupPublishedReaderFixture,
	createPublishedReaderFixture,
} from "./helpers/published-reader-fixture";

afterEach(cleanupPublishedReaderFixture);

describe("campus-web published reader validation", () => {
	it("fails closed when published reader search unit ids collide", async () => {
		const { client, manifestPath } = createPublishedReaderFixture();
		updatePublishedReaderManifest(manifestPath, (manifest) => {
			manifest.searchUnits[1] = {
				...manifest.searchUnits[1],
				searchUnitId: manifest.searchUnits[0].searchUnitId,
			};
		});

		await expect(
			checkCampusPublishedReaderInputs({
				client,
				manifestFilePath: manifestPath,
			}),
		).rejects.toThrow("duplicate published reader searchUnitId");
	});

	it("fails closed when protected search highlights reference missing reader blocks", async () => {
		const { client, manifestPath } = createPublishedReaderFixture();
		updatePublishedReaderManifest(manifestPath, (manifest) => {
			manifest.searchUnits[1] = {
				...manifest.searchUnits[1],
				highlightRootUnitIds: ["missing-root-unit"],
			};
		});

		await expect(
			checkCampusPublishedReaderInputs({
				client,
				manifestFilePath: manifestPath,
			}),
		).rejects.toThrow("protected search unit highlight root does not exist in reader asset");
	});

	it("fails closed when protected search canonicalUrl path differs from the reader route", async () => {
		const { client, manifestPath } = createPublishedReaderFixture();
		updatePublishedReaderManifest(manifestPath, (manifest) => {
			manifest.searchUnits[1] = {
				...manifest.searchUnits[1],
				canonicalUrl: "/docs/regulations/student_rules/other-policy#restricted",
			};
		});

		await expect(
			checkCampusPublishedReaderInputs({
				client,
				manifestFilePath: manifestPath,
			}),
		).rejects.toThrow("protected search unit canonicalUrl does not match reader route");
	});

	it("fails closed when protected search canonicalUrl hash differs from the anchor", async () => {
		const { client, manifestPath } = createPublishedReaderFixture();
		updatePublishedReaderManifest(manifestPath, (manifest) => {
			manifest.searchUnits[1] = {
				...manifest.searchUnits[1],
				canonicalUrl: "/docs/regulations/student_rules/restricted-policy#other-anchor",
			};
		});

		await expect(
			checkCampusPublishedReaderInputs({
				client,
				manifestFilePath: manifestPath,
			}),
		).rejects.toThrow("protected search unit canonicalUrl hash does not match anchor");
	});
});

function updatePublishedReaderManifest(
	manifestPath: string,
	update: (manifest: {
		searchUnits: Array<{
			canonicalUrl: string;
			highlightRootUnitIds: string[];
			searchUnitId: string;
		}>;
	}) => void,
): void {
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
	update(manifest);
	writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
}
