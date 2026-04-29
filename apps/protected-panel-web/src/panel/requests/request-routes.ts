import type { Identifier } from "react-admin";

export function buildRequestShowPath(requestId: Identifier): string {
	return `/requests/${encodeURIComponent(String(requestId))}/show`;
}
