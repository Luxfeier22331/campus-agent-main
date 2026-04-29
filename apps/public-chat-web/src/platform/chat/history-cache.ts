import { unstable_serialize } from "swr/infinite";

const CHAT_HISTORY_PAGE_SIZE = 20;

export function getChatHistoryPaginationKey(
	pageIndex: number,
	previousPageData: { chats: Array<{ id: string }>; hasMore: boolean } | null,
): string | null {
	if (previousPageData && previousPageData.hasMore === false) {
		return null;
	}

	if (pageIndex === 0) {
		return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history?limit=${CHAT_HISTORY_PAGE_SIZE}`;
	}

	const firstChatFromPage = previousPageData?.chats.at(-1);
	if (!firstChatFromPage) {
		return null;
	}

	return `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history?ending_before=${firstChatFromPage.id}&limit=${CHAT_HISTORY_PAGE_SIZE}`;
}

export function getSerializedChatHistoryKey(): string {
	return unstable_serialize(getChatHistoryPaginationKey);
}

export function getClearChatHistoryMutation() {
	return {
		data: [],
		key: getSerializedChatHistoryKey(),
		options: {
			revalidate: false as const,
		},
	};
}
