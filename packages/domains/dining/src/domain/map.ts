import { z } from "zod";
import type { DiningFloorplanBundleV1 } from "../floorplans/bundle.ts";

const sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);

export const DiningMapResponseSchema = z
	.object({
		halls: z.array(
			z
				.object({
					campus: z.string().min(1),
					floors: z.array(
						z
							.object({
								floorId: z.string().min(1),
								floorplan: z
									.object({
										canvas: z
											.object({ height: z.number().positive(), width: z.number().positive() })
											.strict(),
										floorplanId: z.string().min(1),
										sha256,
										svgAssetUrl: z.string().regex(/^\/api\/dining\/floorplans\/[0-9a-f]{64}\.svg$/),
									})
									.strict(),
								label: z.string().min(1),
								windows: z.array(
									z
										.object({
											name: z.string().min(1),
											svgAnchorId: z.string().min(1),
											windowId: z.string().min(1),
										})
										.strict(),
								),
							})
							.strict(),
					),
					hallId: z.string().min(1),
					name: z.string().min(1),
				})
				.strict(),
		),
		releaseId: z.string().min(1),
		updatedAt: z.string().datetime({ offset: true }),
	})
	.strict();

export type DiningMapResponse = z.infer<typeof DiningMapResponseSchema>;

export interface DiningMapDraft {
	bundle: DiningFloorplanBundleV1;
	fingerprint: `sha256:${string}`;
	revision: number;
	updatedAt: string;
	updatedBy: string;
}

export interface DiningMapRelease {
	bundle: DiningFloorplanBundleV1;
	createdAt: string;
	createdBy: string;
	draftRevision: number;
	kind: "publish" | "restore";
	publicPayload: DiningMapResponse;
	releaseId: string;
	restoredFromReleaseId: string | null;
	snapshotHash: `sha256:${string}`;
}

export interface DiningMapPublication {
	releaseId: string;
	updatedAt: string;
	updatedBy: string;
}
