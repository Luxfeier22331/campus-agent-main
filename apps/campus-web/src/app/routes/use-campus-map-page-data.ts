import { useEffect, useState } from "react";
import { getCampusMapManifest, getCampusMapPlaces } from "@/features/map/api";
import {
	type CampusMapProfile,
	createCampusMapProfilesFromManifest,
	getCampusMapProfile,
	getDefaultCampusMapProfile,
} from "@/features/map/campus-map-style";
import type { CampusMapPlacesResponse } from "@/features/map/model";
import { createMapPlaceViews, getMapCampuses, type MapTaskFilter } from "@/features/map/view-model";
import { assertMapProfilesCoverCampuses } from "./map-page-map-support";
import { readMapUrlState } from "./map-page-url-state";

export function useCampusMapPageData() {
	const [data, setData] = useState<CampusMapPlacesResponse | null>(null);
	const [mapProfiles, setMapProfiles] = useState<CampusMapProfile[]>([]);
	const [dataAttempt, setDataAttempt] = useState(0);
	const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [query, setQuery] = useState("");
	const [selectedCampus, setSelectedCampus] = useState<string | null>(null);
	const [selectedCategory, setSelectedCategory] = useState<MapTaskFilter>("all");

	useEffect(() => {
		void dataAttempt;
		const controller = new AbortController();
		setLoading(true);
		setError(null);
		getCampusMapManifest({ signal: controller.signal })
			.then(async (manifest) => ({
				manifest,
				data: await getCampusMapPlaces({
					placesUrl: manifest.placesUrl,
					signal: controller.signal,
				}),
			}))
			.then(({ manifest, data: nextData }) => {
				if (controller.signal.aborted) {
					return;
				}
				const nextProfiles = createCampusMapProfilesFromManifest(manifest);
				const nextCampuses = getMapCampuses(createMapPlaceViews(nextData.places));
				assertMapProfilesCoverCampuses(nextProfiles, nextCampuses);
				const initialState = readMapUrlState(nextCampuses);
				const defaultProfile =
					(initialState.campus ? getCampusMapProfile(nextProfiles, initialState.campus) : null) ??
					getDefaultCampusMapProfile(nextProfiles, nextCampuses);
				setData(nextData);
				setMapProfiles(nextProfiles);
				setSelectedCampus(defaultProfile?.campus ?? null);
				setQuery(initialState.query);
				setSelectedCategory(initialState.category);
				setSelectedPlaceId(initialState.placeId);
			})
			.catch(() => {
				if (controller.signal.aborted) {
					return;
				}
				setData(null);
				setMapProfiles([]);
				setSelectedPlaceId(null);
				setError("校园地图暂时无法打开。");
			})
			.finally(() => {
				if (!controller.signal.aborted) {
					setLoading(false);
				}
			});
		return () => controller.abort();
	}, [dataAttempt]);

	return {
		data,
		error,
		loading,
		mapProfiles,
		query,
		retryData: () => setDataAttempt((attempt) => attempt + 1),
		selectedCampus,
		selectedCategory,
		selectedPlaceId,
		setQuery,
		setSelectedCampus,
		setSelectedCategory,
		setSelectedPlaceId,
	};
}
