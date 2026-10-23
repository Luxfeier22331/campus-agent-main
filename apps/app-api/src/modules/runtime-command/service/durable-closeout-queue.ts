import type { ChatCommandStreamEvent } from "./types";

type DurableCloseoutQueueItem =
	| {
			event: ChatCommandStreamEvent;
			kind: "event";
	  }
	| {
			kind: "done";
	  }
	| {
			error: unknown;
			kind: "error";
	  };

export function createDurableCloseoutQueue() {
	const items: DurableCloseoutQueueItem[] = [];
	const waiters: Array<(item: DurableCloseoutQueueItem) => void> = [];

	function push(item: DurableCloseoutQueueItem) {
		const waiter = waiters.shift();
		if (waiter) {
			waiter(item);
			return;
		}
		items.push(item);
	}

	async function next(): Promise<DurableCloseoutQueueItem> {
		const item = items.shift();
		if (item) {
			return item;
		}
		return new Promise<DurableCloseoutQueueItem>((resolve) => {
			waiters.push(resolve);
		});
	}

	return { next, push };
}
