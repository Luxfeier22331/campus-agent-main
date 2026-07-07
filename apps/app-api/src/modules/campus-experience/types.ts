export type CampusMapPlaceCategory = "building" | "gate" | "landmark" | "service" | "transport";
export type CampusMapFeatureLayer = "boundary" | "building" | "sport";

export interface CampusMapFeatureRef {
	fid: number;
	layer: CampusMapFeatureLayer;
	sourceId: string;
}

export interface CampusMapPlace {
	accessNote: string | null;
	campus: string;
	category: CampusMapPlaceCategory;
	description: string;
	geojson: {
		type: "Feature";
		geometry: {
			type: "Point";
			coordinates: [number, number];
		};
		properties: {
			category: CampusMapPlaceCategory;
			placeId: string;
			title: string;
		};
	};
	id: string;
	mapFeatureRefs?: CampusMapFeatureRef[];
	sourceRefs: string[];
	tags: string[];
	title: string;
}

export interface CampusMapPlacesResponse {
	campus: {
		defaultCenter: [number, number];
		id: string;
		name: string;
	};
	places: CampusMapPlace[];
}

export type FeedbackCategory =
	| "content_issue"
	| "dining_issue"
	| "experience_issue"
	| "map_issue"
	| "other";

export interface SubmitFeedbackInput {
	body: string;
	category: FeedbackCategory;
	contact: string | null;
	routeContext: string;
}

export interface SubmitFeedbackResponse {
	feedback: {
		category: FeedbackCategory;
		feedbackId: string;
		receivedAt: string;
		routeContext: string;
		status: "received";
	};
}

export interface CampusExperienceService {
	getMapPlace(input: { placeId: string }): Promise<{ place: CampusMapPlace }>;
	getMapPlaces(): Promise<CampusMapPlacesResponse>;
	submitFeedback(input: SubmitFeedbackInput): Promise<SubmitFeedbackResponse>;
}
