import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { sanitizeDiningFloorplanSvg } from "../src/floorplans/floorplan-contract";
import rawLayout from "../src/floorplans/layouts/haidian-canteen-1-1f.json" with { type: "json" };
import {
	assertDiningWayfindingLayout,
	canonicalizeDiningWayfindingLayout,
	renderDiningWayfindingSvg,
	serializeDiningWayfindingLayout,
} from "../src/floorplans/wayfinding-layout";

const fs = vi.hoisted(() => ({
	mkdir: vi.fn(async () => undefined),
	readFile: vi.fn(),
	readdir: vi.fn(),
	rename: vi.fn(async () => undefined),
	unlink: vi.fn(async () => undefined),
	writeFile: vi.fn(async () => undefined),
}));

vi.mock("node:fs/promises", () => fs);

import {
	DiningLayoutRevisionConflictError,
	readDiningWayfindingLayoutDocuments,
	saveDiningWayfindingLayout,
} from "../editor/floorplan-files";

describe("Dining floorplan source persistence", () => {
	it("saves only the canonical layout and marks generated assets stale", async () => {
		assertDiningWayfindingLayout(rawLayout);
		const layout = canonicalizeDiningWayfindingLayout(rawLayout);
		configureFiles(layout);
		const [document] = await readDiningWayfindingLayoutDocuments();
		if (!document) {
			throw new Error("Expected one Dining layout document.");
		}
		expect(document.assetStatus).toBe("current");

		const changed = { ...layout, label: `${layout.label}调整` };
		const saved = await saveDiningWayfindingLayout({
			baseRevision: document.revision,
			layout: changed,
		});

		expect(saved.assetStatus).toBe("stale");
		expect(fs.writeFile).toHaveBeenCalledOnce();
		expect(fs.writeFile).toHaveBeenCalledWith(
			expect.stringContaining(`src/floorplans/layouts/${layout.floorId}.json.`),
			serializeDiningWayfindingLayout(changed),
			"utf8",
		);
		expect(fs.rename).toHaveBeenCalledWith(
			expect.stringContaining(`${layout.floorId}.json.`),
			expect.stringMatching(new RegExp(`${layout.floorId}\\.json$`)),
		);
		expect(JSON.stringify(fs.writeFile.mock.calls)).not.toContain("public/assets/dining");
	});

	it("rejects stale source revisions before writing", async () => {
		assertDiningWayfindingLayout(rawLayout);
		const layout = canonicalizeDiningWayfindingLayout(rawLayout);
		configureFiles(layout);

		await expect(
			saveDiningWayfindingLayout({ baseRevision: "sha256:stale", layout }),
		).rejects.toBeInstanceOf(DiningLayoutRevisionConflictError);
		expect(fs.writeFile).not.toHaveBeenCalled();
	});

	it("marks generated assets stale when their semantic identity differs", async () => {
		assertDiningWayfindingLayout(rawLayout);
		const layout = canonicalizeDiningWayfindingLayout(rawLayout);
		configureFiles(layout, { hallId: "other-hall" });

		await expect(readDiningWayfindingLayoutDocuments()).resolves.toEqual([
			expect.objectContaining({ assetStatus: "stale" }),
		]);
	});

	it("removes a temporary source file when atomic replacement fails", async () => {
		assertDiningWayfindingLayout(rawLayout);
		const layout = canonicalizeDiningWayfindingLayout(rawLayout);
		configureFiles(layout);
		const [document] = await readDiningWayfindingLayoutDocuments();
		if (!document) {
			throw new Error("Expected one Dining layout document.");
		}
		fs.rename.mockRejectedValueOnce(new Error("rename failed"));

		await expect(
			saveDiningWayfindingLayout({
				baseRevision: document.revision,
				layout: { ...layout, label: `${layout.label}调整` },
			}),
		).rejects.toThrow("rename failed");
		expect(fs.unlink).toHaveBeenCalledWith(expect.stringContaining(`${layout.floorId}.json.`));
	});
});

function configureFiles(
	layout: ReturnType<typeof canonicalizeDiningWayfindingLayout>,
	generatedIdentity: Partial<{ floorplanId: string; hallId: string }> = {},
) {
	fs.mkdir.mockClear();
	fs.readFile.mockReset();
	fs.readdir.mockReset();
	fs.rename.mockClear();
	fs.unlink.mockClear();
	fs.writeFile.mockClear();
	fs.readdir.mockResolvedValue([`${layout.floorId}.json`] as never);
	const svg = sanitizeDiningFloorplanSvg(renderDiningWayfindingSvg(layout));
	const digest = createHash("sha256").update(svg).digest("hex");
	fs.readFile.mockImplementation(async (path: string) => {
		if (path.endsWith("generated-assets.json")) {
			return JSON.stringify({
				assets: [
					{
						floorId: layout.floorId,
						floorplanId: generatedIdentity.floorplanId ?? layout.floorplanId,
						hallId: generatedIdentity.hallId ?? layout.hallId,
						sha256: `sha256:${digest}`,
					},
				],
				schemaVersion: 2,
			});
		}
		return serializeDiningWayfindingLayout(layout);
	});
}
