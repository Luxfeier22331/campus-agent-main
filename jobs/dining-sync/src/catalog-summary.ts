import type { DiningOperationsState } from "dining-domain";

export interface DiningCatalogPublishSummary {
	hallCount: number;
	menuItemCount: number;
	menuOfferingCount: number;
	releaseId: string | null;
	stallCount: number;
	status: "catalog_published" | "dev_seed_imported";
	visibleHalls: Array<{
		floors: Array<{
			floorId: string;
			label: string;
			svgAssetUrl: string;
		}>;
		hallId: string;
		name: string;
	}>;
}

export function buildDiningCatalogPublishSummary(
	state: DiningOperationsState,
	status: DiningCatalogPublishSummary["status"],
): DiningCatalogPublishSummary {
	return {
		hallCount: state.halls.length,
		menuItemCount: state.menuItems.length,
		menuOfferingCount: state.menuOfferings.length,
		releaseId: state.publishedRelease?.releaseId ?? null,
		stallCount: state.stallProfiles.length,
		status,
		visibleHalls: state.halls.map((hall) => ({
			floors: hall.floors.map((floor) => ({
				floorId: floor.floorId,
				label: floor.label,
				svgAssetUrl: floor.svgAssetUrl,
			})),
			hallId: hall.hallId,
			name: hall.name,
		})),
	};
}
