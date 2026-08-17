export interface ConversationInitializationTarget {
	deleteThread: () => void | Promise<void>;
	initialize: () => Promise<{ remoteId: string }>;
	threadId: string;
}

export interface PendingConversationInitialization {
	deleteThread: () => void | Promise<void>;
	initializeTask: Promise<string | undefined>;
	ownerOperationId: number;
}

export interface LocallyInitializedRunConversation {
	conversationId: string;
	operationId: number;
	threadId: string;
}

export class ConversationInitializationRegistry {
	local: LocallyInitializedRunConversation | null = null;
	private readonly pending = new Map<string, PendingConversationInitialization>();

	get(threadId: string): PendingConversationInitialization | undefined {
		return this.pending.get(threadId);
	}

	getOrCreate(
		target: ConversationInitializationTarget,
		ownerOperationId: number,
	): PendingConversationInitialization {
		const existing = this.pending.get(target.threadId);
		if (existing) {
			existing.ownerOperationId = ownerOperationId;
			return existing;
		}
		const created = {
			deleteThread: target.deleteThread,
			initializeTask: Promise.resolve()
				.then(() => target.initialize())
				.then((result) => result.remoteId ?? undefined),
			ownerOperationId,
		};
		this.pending.set(target.threadId, created);
		return created;
	}

	ownedBy(
		threadId: string,
		initialization: PendingConversationInitialization,
		operationId: number,
	): boolean {
		return (
			this.pending.get(threadId) === initialization &&
			initialization.ownerOperationId === operationId
		);
	}

	delete(threadId: string, expected?: PendingConversationInitialization): void {
		if (!expected || this.pending.get(threadId) === expected) {
			this.pending.delete(threadId);
		}
	}

	clear(): void {
		this.local = null;
		this.pending.clear();
	}
}
