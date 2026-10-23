import { readFile } from "node:fs/promises";
import type { DiningFloorplanBundleV1 } from "@campus-agent/dining/floorplans";
import { expect, test } from "@playwright/test";

test("食堂地图 bundle 可导出再整体导入为草稿", async ({ page }) => {
	const requests: Array<{ method: string; path: string; body: unknown }> = [];
	page.on("request", (request) => {
		const url = new URL(request.url());
		if (url.pathname.startsWith("/api/ops/dining/")) {
			requests.push({
				body: request.postDataJSON() as unknown,
				method: request.method(),
				path: url.pathname,
			});
		}
	});
	await page.goto("/dining");
	await expect(page.getByRole("heading", { name: "平面图维护" })).toBeVisible();
	await expect(page.getByText("学生端已更新", { exact: true })).toBeVisible();

	const downloadPromise = page.waitForEvent("download");
	await page.getByRole("button", { name: "导出食堂地图 bundle" }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toBe("dining-floorplans.bundle.v1.json");
	const path = await download.path();
	expect(path).not.toBeNull();
	const bundle = JSON.parse(await readFile(path as string, "utf8")) as DiningFloorplanBundleV1;
	expect(bundle).toEqual(
		expect.objectContaining({
			kind: "dining_floorplan_bundle",
			layouts: expect.arrayContaining([expect.any(Object)]),
			schemaVersion: 1,
		}),
	);
	const layout = bundle.layouts[0];
	const window = layout?.windows[0];
	if (!(layout && window)) {
		throw new Error("Dining fixture needs an exported layout with a window.");
	}
	window.label = "导入验证窗口";
	bundle.halls = bundle.halls.filter((hall) => hall.hallId === layout.hallId);
	bundle.layouts = [layout];

	const [fileChooser] = await Promise.all([
		page.waitForEvent("filechooser"),
		page.getByRole("button", { name: "导入食堂地图 bundle" }).click(),
	]);
	await fileChooser.setFiles({
		buffer: Buffer.from(JSON.stringify(bundle), "utf8"),
		mimeType: "application/json",
		name: "local-dining.bundle.json",
	});

	const confirmation = page.getByRole("alertdialog", { name: "替换全部食堂地图草稿？" });
	await expect(confirmation).toContainText("这会替换当前所有校区和食堂的地图草稿");
	await expect(confirmation).toContainText("现有发布版本保持不变");
	await confirmation.getByRole("button", { name: "替换草稿", exact: true }).click();
	await expect(confirmation).toBeHidden();
	await expect(page.getByText("草稿待发布", { exact: true })).toBeVisible();
	await expect(page.getByText("dining-release-1", { exact: true })).toBeVisible();
	await expect(page.getByText("dining-release-2", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "发布", exact: true })).toBeEnabled();

	const draftWrite = requests.find(
		(request) => request.method === "PUT" && request.path === "/api/ops/dining/draft",
	);
	expect(draftWrite?.body).toEqual({ bundle, expectedRevision: 1 });
	expect(
		requests.filter(
			(request) => request.method === "POST" && request.path === "/api/ops/dining/publish",
		),
	).toEqual([]);

	const desktopPanel = page.getByRole("complementary", { name: "地图元素" });
	if (await desktopPanel.isVisible()) {
		await expect(desktopPanel).toContainText("导入验证窗口");
	} else {
		await page.getByRole("button", { name: "图层与元素" }).click();
		await expect(page.getByRole("dialog", { name: "图层与元素" })).toContainText("导入验证窗口");
	}
});
