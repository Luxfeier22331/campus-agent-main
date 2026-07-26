import { createCampusGroupsCatalog, parseCampusGroupsCatalogInput } from "./domain";
import type { CampusGroupsService, CampusGroupsStore } from "./types";

export function buildCampusGroupsService(store: CampusGroupsStore): CampusGroupsService {
	return {
		async getCatalog() {
			return createCampusGroupsCatalog(await store.getCatalog());
		},
		async replaceCatalog(value) {
			const catalog = parseCampusGroupsCatalogInput(value);
			await store.replaceCatalog(catalog);
			return catalog;
		},
	};
}

export { createCampusGroupsCatalog, parseCampusGroupsCatalogInput } from "./domain";
