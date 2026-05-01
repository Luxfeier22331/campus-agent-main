import { encodePathIdentifier } from "../data-provider/path";

export function buildAuthenticatedNoticeProcessingShowPath(noticeId: string) {
	return `/authenticatedNoticeProcessing/${encodePathIdentifier(noticeId)}`;
}

export function buildAuthenticatedNoticeRunProcessingShowPath(runProcessingId: string) {
	return `/authenticatedNoticeRunProcessing/${encodePathIdentifier(runProcessingId)}`;
}
