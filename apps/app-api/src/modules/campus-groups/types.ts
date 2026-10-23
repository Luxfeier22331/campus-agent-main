import type { CampusGroupsCatalog } from "campus-contracts/campus-groups";

export interface CampusGroupsStore {
	getCatalog(): Promise<CampusGroupsCatalog>;
	replaceCatalog(catalog: CampusGroupsCatalog): Promise<void>;
}

export interface CampusGroupsService {
	getCatalog(): Promise<CampusGroupsCatalog>;
	replaceCatalog(catalog: unknown): Promise<CampusGroupsCatalog>;
}
