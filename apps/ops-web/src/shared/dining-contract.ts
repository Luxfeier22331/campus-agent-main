import type { DiningMapDraft } from "@campus-agent/dining/domain";
import {
	canonicalizeDiningFloorplanBundle,
	type DiningFloorplanBundleV1,
} from "@campus-agent/dining/floorplans";
import { z } from "zod";

export const DINING_DRAFT_REQUEST_MAX_BYTES = 8 * 1024 * 1024;

const sha256 = z
	.string()
	.regex(/^sha256:[0-9a-f]{64}$/)
	.transform((value) => value as `sha256:${string}`);
const isoDate = z.string().datetime({ offset: true });
const revision = z.number().int().positive();
const bundle = z.unknown().transform((value, context): DiningFloorplanBundleV1 => {
	try {
		return canonicalizeDiningFloorplanBundle(value);
	} catch (error) {
		context.addIssue({
			code: "custom",
			message: error instanceof Error ? error.message : "食堂地图格式无效。",
		});
		return z.NEVER;
	}
});

const draft = z
	.object({
		bundle,
		fingerprint: sha256,
		revision,
		updatedAt: isoDate,
		updatedBy: z.string().min(1),
	})
	.strict();

export const DiningReleaseSummarySchema = z
	.object({
		createdAt: isoDate,
		createdBy: z.string().min(1),
		draftRevision: revision,
		kind: z.enum(["publish", "restore"]),
		releaseId: z.string().min(1),
		restoredFromReleaseId: z.string().min(1).nullable(),
		snapshotHash: sha256,
	})
	.strict();

export type DiningReleaseSummary = z.infer<typeof DiningReleaseSummarySchema>;

export interface DiningOpsState {
	currentRelease: DiningReleaseSummary | null;
	draft: DiningMapDraft;
}

export interface DiningReleaseList {
	currentReleaseId: string | null;
	releases: DiningReleaseSummary[];
}

export const DiningDraftUpdateSchema = z
	.object({
		bundle,
		expectedRevision: revision,
	})
	.strict();

export const DiningRevisionSchema = z.object({ expectedRevision: revision }).strict();

export const DiningOpsStateResponseSchema = z
	.object({
		currentRelease: DiningReleaseSummarySchema.nullable(),
		draft,
	})
	.strict();

export const DiningDraftResponseSchema = z.object({ draft }).strict();

export const DiningReleaseResponseSchema = z
	.object({ release: DiningReleaseSummarySchema })
	.strict();

export const DiningRestoreResponseSchema = z
	.object({ draft, release: DiningReleaseSummarySchema })
	.strict();

export const DiningReleaseListResponseSchema = z
	.object({
		currentReleaseId: z.string().min(1).nullable(),
		releases: z.array(DiningReleaseSummarySchema),
	})
	.strict();
