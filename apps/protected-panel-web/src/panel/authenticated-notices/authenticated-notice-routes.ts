import { encodePathIdentifier } from "../data-provider/path";

export function buildAuthenticatedNoticeProcessingShowPath(noticeId: string) {
	return `/authenticatedNoticeProcessing/${encodePathIdentifier(noticeId)}`;
}
