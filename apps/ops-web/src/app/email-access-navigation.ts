import type { EmailAccessGrantKind, EmailAccessGrantState } from "campus-contracts/email-access";
import { optionalBoundedSearchString } from "./ops-view-helpers";
export interface EmailAccessSearch {
	email?: string | undefined;
	kind?: EmailAccessGrantKind | undefined;
	state?: EmailAccessGrantState | undefined;
	cursor?: string | undefined;
	history?: string | undefined;
}
export function readEmailAccessSearch(search: Record<string, unknown>): EmailAccessSearch {
	return {
		email: optionalBoundedSearchString(search.email, 320),
		kind: search.kind === "invitation" || search.kind === "test" ? search.kind : undefined,
		state:
			search.state === "active" ||
			search.state === "expired" ||
			search.state === "pending" ||
			search.state === "revoked"
				? search.state
				: undefined,
		cursor: optionalBoundedSearchString(search.cursor, 512),
		history: optionalBoundedSearchString(search.history, 16000),
	};
}
