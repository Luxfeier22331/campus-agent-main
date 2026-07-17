import type { DiningPublication } from "./model";

export type DiningPublicationChange = "catalog" | "reviews" | null;

export function classifyDiningPublicationChange(
	previous: DiningPublication,
	current: DiningPublication,
): DiningPublicationChange {
	if (previous.catalogReleaseId !== current.catalogReleaseId) {
		return "catalog";
	}
	if (previous.reviewRevision !== current.reviewRevision) {
		return "reviews";
	}
	return null;
}
