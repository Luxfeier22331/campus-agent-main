export type {
	CampusGroup,
	CampusGroupSection,
	CampusGroupsCatalog,
} from "campus-contracts/campus-groups";
export {
	buildCampusGroupsService,
	createCampusGroupsCatalog,
	parseCampusGroupsCatalogInput,
} from "./service";
export { createPgCampusGroupsStore } from "./store";
export type {
	CampusGroupsService,
	CampusGroupsStore,
} from "./types";
