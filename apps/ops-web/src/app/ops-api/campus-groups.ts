import {
	type CampusGroupsCatalog,
	CampusGroupsCatalogSchema,
} from "campus-contracts/campus-groups";
import { fetchJson } from "./core";

export async function fetchCampusGroupsCatalog(input: { signal?: AbortSignal } = {}) {
	return CampusGroupsCatalogSchema.parse(
		await fetchJson("/api/ops/groups/catalog", { signal: input.signal }),
	);
}

export async function replaceCampusGroupsCatalog(
	catalog: CampusGroupsCatalog,
): Promise<CampusGroupsCatalog> {
	return CampusGroupsCatalogSchema.parse(
		await fetchJson("/api/ops/groups/catalog", {
			body: JSON.stringify(catalog),
			headers: { "content-type": "application/json" },
			method: "PUT",
		}),
	);
}
