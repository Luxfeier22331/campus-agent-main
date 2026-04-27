import type { UIMessage } from "ai";

export type ArtifactKind = "code" | "image" | "sheet" | "text";

export interface MessageMetadata {
	createdAt: string;
}

export const messageMetadataSchema = {
	parse(value: unknown) {
		return value as MessageMetadata;
	},
};

export interface SuggestionRecord {
	createdAt: Date | string;
	description?: string | null;
	documentCreatedAt: Date | string;
	documentId: string;
	id: string;
	isResolved: boolean;
	originalText: string;
	suggestedText: string;
	userId: string;
}

export interface PlaceCardData {
	accessNote?: string;
	campusScope?: string;
	campusArea?: string;
	coordinateReferenceSystem?: string;
	displayName: string;
	entityType: "building" | "service_point" | "office" | "gate" | "stop";
	landmarkHint?: string;
	locationDescription: string;
	openingNote?: string;
	placeId: string;
	pointGeometry?: {
		coordinates: [number, number];
		type: "Point";
	};
	serviceTags?: string[];
	sourceRefs?: string[];
}

export interface SourceCardData {
	title: string;
	sectionTitle: string;
	snippet: string;
	href: string;
	collectionLabel: string;
	versionLabel: string;
	pageLabel: string;
}

export interface CampusServiceTraceCardData {
	title: string;
	refs: string[];
}

interface WeatherToolOutput {
	cityName?: string;
	current: {
		interval: number;
		temperature_2m: number;
		time: string;
	};
	current_units: {
		interval: string;
		temperature_2m: string;
		time: string;
	};
	daily: {
		sunrise: string[];
		sunset: string[];
		time: string[];
	};
	daily_units: {
		sunrise: string;
		sunset: string;
		time: string;
	};
	elevation: number;
	generationtime_ms: number;
	hourly: {
		temperature_2m: number[];
		time: string[];
	};
	hourly_units: {
		temperature_2m: string;
		time: string;
	};
	latitude: number;
	longitude: number;
	timezone: string;
	timezone_abbreviation: string;
	utc_offset_seconds: number;
}

interface DocumentToolResultRecord {
	content?: string;
	id: string;
	kind: ArtifactKind;
	title: string;
}

interface DocumentToolError {
	error: unknown;
}

interface SuggestionToolResultRecord {
	id: string;
	kind: ArtifactKind;
	message: string;
	title: string;
}

// biome-ignore lint/style/useConsistentTypeDefinitions: UIDataTypes expects type-alias structural compatibility without widening to a string index signature.
export type CustomUIDataTypes = {
	"chat-title": string;
	appendMessage: string;
	clear: null;
	codeDelta: string;
	finish: null;
	id: string;
	imageDelta: string;
	kind: ArtifactKind;
	"place-card": PlaceCardData;
	"source-cards": SourceCardData[];
	"campus-service-trace-cards": CampusServiceTraceCardData[];
	sheetDelta: string;
	suggestion: SuggestionRecord;
	textDelta: string;
	title: string;
};

interface ChatToolDefinitions {
	createDocument: {
		input: { kind: ArtifactKind; title: string };
		output: DocumentToolError | DocumentToolResultRecord;
	};
	getWeather: {
		input:
			| { city: string; latitude?: number; longitude?: number }
			| { city?: string; latitude: number; longitude: number };
		output: WeatherToolOutput;
	};
	requestSuggestions: {
		input: { documentId: string };
		output: DocumentToolError | SuggestionToolResultRecord;
	};
	updateDocument: {
		input: { description: string; id: string };
		output: DocumentToolError | DocumentToolResultRecord;
	};
}

export type ChatTools = {
	[NAME in keyof ChatToolDefinitions & string]: ChatToolDefinitions[NAME];
};

type BaseChatMessage = UIMessage<MessageMetadata, CustomUIDataTypes, ChatTools>;

export type ChatMessage = BaseChatMessage & {
	kind?: "answer" | "clarification" | "error" | "no_answer" | "user";
	requestId?: string | null;
	retryable?: boolean;
};

export type ChatMessagePart = ChatMessage["parts"][number];

export interface Attachment {
	contentType: string;
	name: string;
	url: string;
}
