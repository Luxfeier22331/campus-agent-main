import type { Identifier } from "react-admin";

export function encodePathIdentifier(id: Identifier): string {
	return encodeURIComponent(String(id));
}
