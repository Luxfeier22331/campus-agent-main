export type CampusUiStateKind =
	| "initial-loading"
	| "refreshing"
	| "empty"
	| "not-found"
	| "error"
	| "unavailable"
	| "degraded"
	| "action-feedback";

export type CampusUiStatePresentation = "skeleton" | "inline" | "section" | "page" | "overlay";

export const CAMPUS_UI_STATE_POLICY: Readonly<
	Record<
		CampusUiStateKind,
		{
			defaultPresentation: CampusUiStatePresentation;
			preservesContent: boolean;
			userVisible: boolean;
		}
	>
> = {
	"initial-loading": {
		defaultPresentation: "skeleton",
		preservesContent: false,
		userVisible: true,
	},
	refreshing: {
		defaultPresentation: "inline",
		preservesContent: true,
		userVisible: false,
	},
	empty: {
		defaultPresentation: "section",
		preservesContent: false,
		userVisible: true,
	},
	"not-found": {
		defaultPresentation: "page",
		preservesContent: false,
		userVisible: true,
	},
	error: {
		defaultPresentation: "section",
		preservesContent: true,
		userVisible: true,
	},
	unavailable: {
		defaultPresentation: "section",
		preservesContent: true,
		userVisible: true,
	},
	degraded: {
		defaultPresentation: "overlay",
		preservesContent: true,
		userVisible: true,
	},
	"action-feedback": {
		defaultPresentation: "inline",
		preservesContent: true,
		userVisible: true,
	},
};
