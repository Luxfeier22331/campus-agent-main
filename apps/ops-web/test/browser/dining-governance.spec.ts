import { expect, test } from "@playwright/test";

const at = "2026-09-14T08:00:00.000Z";

test("投稿举报使用投稿版本处理，旧评价举报明确历史不可回放", async ({ page }) => {
	let resolved = false;
	let submitted: unknown;
	const reports = [
		{
			createdAt: at,
			details: "投稿说明",
			reason: "other",
			reportId: "same-report-id",
			reporterUserId: "reader",
			resolution: null,
			resolvedAt: null,
			resolvedBy: null,
			target: {
				kind: "submission",
				targetRevision: 1,
				reported: { replayable: true, name: "举报时投稿", priceText: "10 元", photo: null },
				current: {
					accountDeletingAt: null,
					authorDisplayName: "投稿同学",
					authorId: "author",
					canDelete: true,
					canRestore: false,
					canUnhide: false,
					contentRevision: 2,
					createdAt: at,
					deletedAt: null,
					deletedBy: null,
					expiresAt: null,
					hiddenAt: null,
					hiddenBy: null,
					name: "当前投稿",
					pendingReportCount: 1,
					photo: null,
					priceText: "12 元",
					revision: 3,
					status: "public",
					submissionId: "shared-target",
					updatedAt: at,
					updatedBy: "author",
					windowAvailable: true,
					windowId: "hall:floor:window",
				},
			},
		},
		{
			createdAt: at,
			details: "旧评价举报",
			reason: "privacy",
			reportId: "same-report-id",
			reporterUserId: null,
			resolution: null,
			resolvedAt: null,
			resolvedBy: null,
			target: {
				kind: "review",
				targetRevision: null,
				reported: { replayable: false },
				current: {
					anonymous: true,
					authorDisplayName: null,
					authorId: null,
					authorKind: "member",
					body: "当前评价不能用作举报历史",
					contentRevision: 2,
					createdAt: at,
					deletedAt: null,
					editCount: 1,
					editedAt: at,
					hiddenAt: null,
					hiddenBy: null,
					reviewId: "shared-target",
					submissionId: "parent-submission",
					submissionName: null,
					targetKind: "submission",
					updatedAt: at,
					updatedBy: null,
					windowId: null,
				},
			},
		},
	];
	await page.route("**/api/ops/dining/reports?*", async (route) => {
		await route.fulfill({ json: { items: resolved ? [reports[1]] : reports, nextCursor: null } });
	});
	await page.route("**/api/ops/dining/submissions/shared-target/reports/resolve", async (route) => {
		submitted = route.request().postDataJSON();
		resolved = true;
		await route.fulfill({ status: 204 });
	});
	await page.goto("/dining/reports");
	const itemRole = (page.viewportSize()?.width ?? 0) < 768 ? "listitem" : "row";
	const submissionRow = page.getByRole(itemRole).filter({ hasText: "投稿说明" });
	await expect(submissionRow).toContainText("当前投稿 · 12 元");
	await expect(submissionRow).toContainText("举报时：举报时投稿 · 10 元");
	const reviewRow = page.getByRole(itemRole).filter({ hasText: "旧评价举报" });
	await expect(reviewRow).toContainText("当前评价不能用作举报历史");
	await expect(reviewRow).toContainText("举报时：历史不可回放");
	await submissionRow.getByRole("button", { name: "保留", exact: true }).click();
	await page
		.getByRole("alertdialog", { name: "保留这条投稿？" })
		.getByRole("button", { name: "保留投稿" })
		.click();
	await expect(submissionRow).toHaveCount(0);
	expect(submitted).toEqual({ expectedRevision: 3, resolution: "keep" });
	await expect(reviewRow).toBeVisible();
});
