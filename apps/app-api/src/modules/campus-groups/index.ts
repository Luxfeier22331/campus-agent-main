export type {
	CampusGroup,
	CampusGroupSection,
	CampusGroupsCatalog,
} from "campus-contracts/campus-groups";
export {
	buildCampusGroupsService,
	parseCampusGroupsCatalogInput,
} from "./service";
export { createPgCampusGroupsStore } from "./store";
export type {
	CampusGroupsService,
	CampusGroupsStore,
} from "./types";
