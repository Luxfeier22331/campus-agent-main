import { parseCampusGroupsCatalogInput } from "./domain";
import type { CampusGroupsService, CampusGroupsStore } from "./types";

export function buildCampusGroupsService(store: CampusGroupsStore): CampusGroupsService {
	return {
		async getCatalog() {
			// replaceCatalog is the only writer and stores catalogs that already passed the contract.
			return store.getCatalog();
		},
		async replaceCatalog(value) {
			const catalog = parseCampusGroupsCatalogInput(value);
			await store.replaceCatalog(catalog);
			return catalog;
		},
	};
}

export { parseCampusGroupsCatalogInput } from "./domain";
