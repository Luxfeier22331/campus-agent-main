import { describe, expect, it } from "vitest";
import {
	DiningMenuItemSchema,
	DiningMySubmissionSchema,
	DiningOpsContentReportRecordSchema,
	DiningOpsContentReviewRecordSchema,
	DiningOpsReportRecordSchema,
	DiningOpsSubmissionDetailSchema,
	DiningOpsSubmissionHistoricalPhotoSchema,
	DiningOpsSubmissionRecordSchema,
	DiningOpsSubmissionReportResolutionSchema,
	DiningOpsSubmissionRevisionSchema,
	DiningOpsSubmissionVisibilitySchema,
	DiningReviewCreateSchema,
	DiningReviewReportCreateSchema,
	DiningReviewSchema,
	DiningSubmissionCreateSchema,
	DiningSubmissionReviewCreateSchema,
	DiningSubmissionReviewReportCreateSchema,
	DiningSubmissionReviewSchema,
	DiningSubmissionRevisionSchema,
	DiningSubmissionSchema,
	DiningSubmissionUpdateSchema,
} from "../src/domain/index.ts";

const createdAt = "2026-09-11T10:00:00+08:00";
const publicSubmission = {
	authorName: "Student",
	canReport: true,
	createdAt,
	hasReported: false,
	name: "Rice",
	photo: {
		height: 900,
		photoId: "photo-1",
		url: "/api/dining/submissions/submission-1/photos/photo-1",
		width: 1600,
	},
	priceText: null,
	source: "user_submission",
	submissionId: "submission-1",
	updatedAt: createdAt,
	windowId: "window-1",
};

const ownMetadata = {
	canDelete: true,
	canEdit: true,
	createdAt,
	deletedAt: null,
	expiresAt: null,
	hiddenAt: null,
	revision: 1,
	submissionId: "submission-1",
	updatedAt: createdAt,
	windowAvailable: true,
	windowId: "window-1",
};

describe("dining submission inputs", () => {
	it("normalizes full content and requires an explicit photo operation", () => {
		expect(
			DiningSubmissionCreateSchema.parse({ name: " Rice ", photoAction: "none", priceText: null }),
		).toEqual({ name: "Rice", photoAction: "none", priceText: null });
		for (const photoAction of ["none", "replace"]) {
			expect(
				DiningSubmissionCreateSchema.safeParse({ name: "Rice", photoAction, priceText: " 12 " })
					.success,
			).toBe(true);
		}
		for (const photoAction of ["keep", "remove", "replace"]) {
			expect(
				DiningSubmissionUpdateSchema.safeParse({ name: "Rice", photoAction, priceText: null })
					.success,
			).toBe(true);
		}
		for (const schema of [DiningSubmissionCreateSchema, DiningSubmissionUpdateSchema]) {
			expect(schema.safeParse({ name: "Rice", priceText: null }).success).toBe(false);
			expect(schema.safeParse({ name: "Rice", photoAction: "replace" }).success).toBe(false);
			expect(schema.safeParse({ name: " ", photoAction: "replace", priceText: null }).success).toBe(
				false,
			);
		}
		expect(
			DiningSubmissionCreateSchema.safeParse({ name: "Rice", photoAction: "keep", priceText: null })
				.success,
		).toBe(false);
		expect(
			DiningSubmissionUpdateSchema.safeParse({ name: "Rice", photoAction: "none", priceText: null })
				.success,
		).toBe(false);
	});

	it.each(["authorId", "windowId", "status", "revision", "photo", "photoUrl", "objectKey"])(
		"rejects client-supplied %s in create and update metadata",
		(field) => {
			for (const schema of [DiningSubmissionCreateSchema, DiningSubmissionUpdateSchema]) {
				expect(
					schema.safeParse({
						[field]: "untrusted",
						name: "Rice",
						photoAction: "replace",
						priceText: null,
					}).success,
				).toBe(false);
			}
		},
	);

	it("accepts only positive integer revisions", () => {
		expect(DiningSubmissionRevisionSchema.parse(1)).toBe(1);
		for (const revision of [0, -1, 1.5, "1", Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(DiningSubmissionRevisionSchema.safeParse(revision).success).toBe(false);
		}
	});
});

describe("dining submission projections", () => {
	it("returns only the public content and a controlled current-photo path", () => {
		expect(DiningSubmissionSchema.parse(publicSubmission)).toEqual(publicSubmission);
		expect(DiningSubmissionSchema.safeParse({ ...publicSubmission, photo: null }).success).toBe(
			true,
		);
		for (const field of ["authorId", "revision", "hiddenAt", "reports", "history", "objectKey"]) {
			expect(
				DiningSubmissionSchema.safeParse({ ...publicSubmission, [field]: "internal" }).success,
			).toBe(false);
		}
		for (const url of [
			"https://objects.example.test/submission-1.webp",
			"//objects.example.test/submission-1.webp",
			"/api/dining/me/submissions/submission-1/photos/photo-1",
			"/api/dining/submissions/submission-1/photos/photo-1?key=private",
			"/api/dining/submissions/../photos/photo-1",
		]) {
			expect(
				DiningSubmissionSchema.safeParse({
					...publicSubmission,
					photo: { ...publicSubmission.photo, url },
				}).success,
			).toBe(false);
		}
	});

	it("allows an owner to inspect current hidden content through the owner photo route", () => {
		const submission = {
			...ownMetadata,
			hiddenAt: createdAt,
			name: "Rice",
			photo: {
				...publicSubmission.photo,
				url: "/api/dining/me/submissions/submission-1/photos/photo-1",
			},
			priceText: null,
			status: "hidden",
		};
		expect(DiningMySubmissionSchema.parse(submission)).toEqual(submission);
		for (const field of ["authorId", "reports", "history", "hiddenBy", "moderationNote"]) {
			expect(
				DiningMySubmissionSchema.safeParse({ ...submission, [field]: "internal" }).success,
			).toBe(false);
		}
		expect(
			DiningMySubmissionSchema.safeParse({ ...submission, photo: publicSubmission.photo }).success,
		).toBe(false);
	});

	it.each(["deleted", "expired"])("limits the owner's %s projection to metadata", (status) => {
		const submission = {
			...ownMetadata,
			canDelete: false,
			canEdit: false,
			deletedAt: createdAt,
			expiresAt: "2026-10-11T10:00:00+08:00",
			status,
		};
		expect(DiningMySubmissionSchema.parse(submission)).toEqual(submission);
		for (const content of [
			{ name: "Rice" },
			{ priceText: null },
			{ photo: null },
			{ history: [] },
		]) {
			expect(DiningMySubmissionSchema.safeParse({ ...submission, ...content }).success).toBe(false);
		}
		expect(DiningMySubmissionSchema.safeParse({ ...submission, canEdit: true }).success).toBe(
			false,
		);
		expect(DiningMySubmissionSchema.safeParse({ ...submission, canDelete: true }).success).toBe(
			false,
		);
	});
});

describe("dining review target compatibility", () => {
	const review = {
		anonymous: false,
		authorName: "Student",
		body: "Fresh food.",
		canDelete: false,
		canReport: true,
		createdAt,
		edited: false,
		hasReported: false,
		menuItemId: "menu-1",
		reviewId: "review-1",
	};

	it("keeps the existing menu and review DTOs while requiring one submission target", () => {
		expect(
			DiningMenuItemSchema.parse({
				menuItemId: "menu-1",
				name: "Rice",
				priceText: null,
				sortOrder: 0,
			}),
		).toEqual({ menuItemId: "menu-1", name: "Rice", priceText: null, sortOrder: 0 });
		expect(DiningReviewSchema.parse(review)).toEqual(review);
		const { menuItemId: _menuItemId, ...content } = review;
		const submissionReview = { ...content, submissionId: "submission-1" };
		expect(DiningSubmissionReviewSchema.parse(submissionReview)).toEqual(submissionReview);
		expect(DiningSubmissionReviewSchema.safeParse(content).success).toBe(false);
		expect(DiningSubmissionReviewSchema.safeParse({ ...review, ...submissionReview }).success).toBe(
			false,
		);
		expect(DiningReviewSchema.safeParse(submissionReview).success).toBe(false);
	});

	it("reuses existing create and report input contracts", () => {
		expect(DiningSubmissionReviewCreateSchema).toBe(DiningReviewCreateSchema);
		expect(DiningSubmissionReviewReportCreateSchema).toBe(DiningReviewReportCreateSchema);
	});
});

const opsSubmission = {
	accountDeletingAt: null,
	authorDisplayName: "Student",
	authorId: "student-1",
	canDelete: true,
	canRestore: false,
	canUnhide: true,
	contentRevision: 2,
	createdAt,
	deletedAt: null,
	deletedBy: null,
	expiresAt: null,
	hiddenAt: createdAt,
	hiddenBy: "operator-1",
	name: "Rice",
	pendingReportCount: 1,
	photo: {
		...publicSubmission.photo,
		url: "/api/ops/dining/submissions/submission-1/photos/photo-1",
	},
	priceText: null,
	revision: 3,
	status: "hidden",
	submissionId: "submission-1",
	updatedAt: createdAt,
	updatedBy: "operator-1",
	windowAvailable: true,
	windowId: "window-1",
};

const opsReview = {
	anonymous: false,
	authorDisplayName: "Student",
	authorId: "student-1",
	authorKind: "member",
	body: "Fresh food.",
	contentRevision: 2,
	createdAt,
	deletedAt: null,
	editCount: 1,
	editedAt: createdAt,
	hiddenAt: null,
	hiddenBy: null,
	menuItemId: "menu-1",
	menuItemName: "Rice",
	reviewId: "review-1",
	targetKind: "menu_item",
	updatedAt: createdAt,
	updatedBy: "operator-1",
	windowId: "window-1",
};

const reportMetadata = {
	createdAt,
	details: null,
	reason: "other",
	reportId: "report-1",
	reporterUserId: "student-2",
	resolution: null,
	resolvedAt: null,
	resolvedBy: null,
};

describe("dining submission governance contracts", () => {
	it("retains deleted content for Ops but removes it from expired records", () => {
		const deleted = {
			...opsSubmission,
			canDelete: false,
			canRestore: true,
			canUnhide: false,
			deletedAt: createdAt,
			deletedBy: "student-1",
			expiresAt: "2026-10-11T10:00:00+08:00",
			status: "deleted",
		};
		expect(DiningOpsSubmissionRecordSchema.parse(deleted)).toEqual(deleted);
		const { name: _name, photo: _photo, priceText: _priceText, ...metadata } = deleted;
		const expired = { ...metadata, canRestore: false, status: "expired" };
		expect(DiningOpsSubmissionRecordSchema.parse(expired)).toEqual(expired);
		expect(
			DiningOpsSubmissionRecordSchema.safeParse({
				...deleted,
				canRestore: false,
				status: "expired",
			}).success,
		).toBe(false);
	});

	it("keeps current and historical photos on the protected Ops proxy", () => {
		expect(DiningOpsSubmissionRecordSchema.parse(opsSubmission)).toEqual(opsSubmission);
		expect(
			DiningOpsSubmissionRecordSchema.safeParse({
				...opsSubmission,
				photo: publicSubmission.photo,
			}).success,
		).toBe(false);
		const photo = { ...opsSubmission.photo, expiresAt: null, state: "available" };
		expect(DiningOpsSubmissionHistoricalPhotoSchema.parse(photo)).toEqual(photo);
		const expired = {
			expiresAt: "2026-10-11T10:00:00+08:00",
			photoId: "photo-1",
			state: "expired",
		};
		expect(DiningOpsSubmissionHistoricalPhotoSchema.parse(expired)).toEqual(expired);
		expect(
			DiningOpsSubmissionHistoricalPhotoSchema.safeParse({
				...expired,
				url: opsSubmission.photo.url,
			}).success,
		).toBe(false);
	});

	it("represents before/after content and an independently expired historical photo", () => {
		const edit = {
			editId: "edit-1",
			editedAt: createdAt,
			editedBy: "student-1",
			next: { name: "Rice", photo: null, priceText: null, replayable: true },
			nextRevision: 2,
			previous: {
				name: "Rice",
				photo: {
					expiresAt: "2026-10-11T10:00:00+08:00",
					photoId: "photo-1",
					state: "expired",
				},
				priceText: "12",
				replayable: true,
			},
			previousRevision: 1,
		};
		const detail = { edits: [edit], submission: opsSubmission };
		expect(DiningOpsSubmissionDetailSchema.parse(detail)).toEqual(detail);
		expect(
			DiningOpsSubmissionDetailSchema.safeParse({
				...detail,
				edits: [{ ...edit, previous: { replayable: false } }],
			}).success,
		).toBe(true);
		expect(
			DiningOpsSubmissionDetailSchema.safeParse({
				...detail,
				edits: [{ ...edit, previous: { name: "Retained text", replayable: false } }],
			}).success,
		).toBe(false);
		expect(
			DiningOpsSubmissionDetailSchema.safeParse({
				...detail,
				edits: [{ ...edit, nextRevision: 1 }],
			}).success,
		).toBe(false);
	});

	it("requires the expected revision for independent moderation actions", () => {
		expect(DiningOpsSubmissionRevisionSchema.parse({ expectedRevision: 3 })).toEqual({
			expectedRevision: 3,
		});
		for (const visible of [true, false]) {
			expect(
				DiningOpsSubmissionVisibilitySchema.safeParse({ expectedRevision: 3, visible }).success,
			).toBe(true);
		}
		for (const resolution of ["keep", "hide"]) {
			expect(
				DiningOpsSubmissionReportResolutionSchema.safeParse({ expectedRevision: 3, resolution })
					.success,
			).toBe(true);
		}
		expect(DiningOpsSubmissionVisibilitySchema.safeParse({ visible: true }).success).toBe(false);
		expect(
			DiningOpsSubmissionReportResolutionSchema.safeParse({
				expectedRevision: 3,
				resolution: "keep",
				visible: true,
			}).success,
		).toBe(false);
	});

	it("identifies the reported parent revision separately from the current parent", () => {
		const report = {
			...reportMetadata,
			target: {
				current: opsSubmission,
				kind: "submission",
				reported: { name: "Previous name", photo: null, priceText: "12", replayable: true },
				targetRevision: 1,
			},
		};
		expect(DiningOpsContentReportRecordSchema.parse(report)).toEqual(report);
		expect(
			DiningOpsContentReportRecordSchema.safeParse({
				...report,
				target: { ...report.target, targetRevision: 3 },
			}).success,
		).toBe(false);
		expect(
			DiningOpsContentReportRecordSchema.safeParse({
				...report,
				target: { ...report.target, kind: "review" },
			}).success,
		).toBe(false);
	});

	it("supports reports on either review target without changing the legacy report wire", () => {
		const report = {
			...reportMetadata,
			target: {
				current: opsReview,
				kind: "review",
				reported: { body: "Original body.", replayable: true },
				targetRevision: 1,
			},
		};
		expect(DiningOpsContentReportRecordSchema.parse(report)).toEqual(report);
		const { menuItemId: _menuItemId, menuItemName: _menuItemName, ...reviewContent } = opsReview;
		const submissionReview = {
			...reviewContent,
			submissionId: "submission-1",
			submissionName: "Rice",
			targetKind: "submission",
		};
		expect(
			DiningOpsContentReportRecordSchema.safeParse({
				...report,
				target: { ...report.target, current: submissionReview },
			}).success,
		).toBe(true);
		expect(
			DiningOpsContentReviewRecordSchema.safeParse({ ...submissionReview, menuItemId: "menu-1" })
				.success,
		).toBe(false);
		const { contentRevision: _revision, targetKind: _targetKind, ...legacyReview } = opsReview;
		const legacyReport = { ...reportMetadata, review: legacyReview };
		expect(DiningOpsReportRecordSchema.parse(legacyReport)).toEqual(legacyReport);
		expect(DiningOpsReportRecordSchema.safeParse(report).success).toBe(false);
	});

	it("does not claim replayable content for a legacy report without a known revision", () => {
		const report = {
			...reportMetadata,
			target: {
				current: opsReview,
				kind: "review",
				reported: { replayable: false },
				targetRevision: null,
			},
		};
		expect(DiningOpsContentReportRecordSchema.parse(report)).toEqual(report);
		expect(
			DiningOpsContentReportRecordSchema.safeParse({
				...report,
				target: { ...report.target, reported: { body: "Current text", replayable: true } },
			}).success,
		).toBe(false);
	});

	it("keeps only reference metadata after the parent has been purged", () => {
		const purged = {
			canDelete: false,
			canRestore: false,
			canUnhide: false,
			contentRevision: 2,
			purgedAt: createdAt,
			revision: 4,
			status: "purged",
			submissionId: "submission-1",
		};
		expect(DiningOpsSubmissionRecordSchema.parse(purged)).toEqual(purged);
		for (const field of ["authorId", "authorDisplayName", "windowId", "name", "photo"]) {
			expect(
				DiningOpsSubmissionRecordSchema.safeParse({ ...purged, [field]: "old-content" }).success,
			).toBe(false);
		}
		const { menuItemId: _id, menuItemName: _name, ...content } = opsReview;
		expect(
			DiningOpsContentReviewRecordSchema.safeParse({
				...content,
				submissionId: purged.submissionId,
				submissionName: null,
				targetKind: "submission",
				windowId: null,
			}).success,
		).toBe(true);
	});

	it("exposes account withdrawal without granting restore or delete actions", () => {
		const withdrawing = {
			...opsSubmission,
			accountDeletingAt: createdAt,
			canDelete: false,
			canUnhide: false,
		};
		expect(DiningOpsSubmissionRecordSchema.parse(withdrawing)).toEqual(withdrawing);
		expect(
			DiningOpsSubmissionRecordSchema.safeParse({ ...withdrawing, canUnhide: true }).success,
		).toBe(false);
	});
});
