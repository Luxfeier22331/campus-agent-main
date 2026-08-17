export interface BufferedAssistantAnswer {
	messageId: string;
	occurredAt: string;
	text: string;
}

interface AssistantFrameState {
	frameId: number;
	messageId: string;
	occurredAt: string;
}

export class AssistantAnswerBuffer {
	private frame: AssistantFrameState | null = null;
	private readonly occurredAtByMessage = new Map<string, string>();
	private readonly provisionalMessageIds = new Set<string>();
	private readonly textByMessage = new Map<string, string>();

	append(messageId: string, delta: string, occurredAt: string): void {
		this.textByMessage.set(messageId, (this.textByMessage.get(messageId) ?? "") + delta);
		this.occurredAtByMessage.set(messageId, occurredAt);
	}

	cancelFrame(): void {
		if (this.frame) {
			window.cancelAnimationFrame(this.frame.frameId);
		}
		this.frame = null;
	}

	clear(): Set<string> {
		this.cancelFrame();
		const provisionalIds = new Set(this.provisionalMessageIds);
		this.provisionalMessageIds.clear();
		this.textByMessage.clear();
		this.occurredAtByMessage.clear();
		return provisionalIds;
	}

	flush(reveal: (answer: BufferedAssistantAnswer) => void): void {
		const current = this.frame;
		if (!current) {
			return;
		}
		this.cancelFrame();
		this.reveal(current.messageId, current.occurredAt, reveal);
	}

	markCanonical(): void {
		this.clear();
	}

	revealAll(reveal: (answer: BufferedAssistantAnswer) => void): void {
		this.cancelFrame();
		for (const [messageId] of this.textByMessage) {
			const occurredAt = this.occurredAtByMessage.get(messageId);
			if (occurredAt) {
				this.reveal(messageId, occurredAt, reveal);
			}
		}
	}

	schedule(
		messageId: string,
		occurredAt: string,
		reveal: (answer: BufferedAssistantAnswer) => void,
	): void {
		const pending = this.frame;
		if (pending?.messageId === messageId) {
			pending.occurredAt = occurredAt;
			return;
		}
		if (pending) {
			this.flush(reveal);
		}
		const frame: AssistantFrameState = { frameId: 0, messageId, occurredAt };
		frame.frameId = window.requestAnimationFrame(() => {
			if (this.frame !== frame) {
				return;
			}
			this.frame = null;
			this.reveal(frame.messageId, frame.occurredAt, reveal);
		});
		this.frame = frame;
	}

	private reveal(
		messageId: string,
		occurredAt: string,
		reveal: (answer: BufferedAssistantAnswer) => void,
	): void {
		this.provisionalMessageIds.add(messageId);
		reveal({ messageId, occurredAt, text: this.textByMessage.get(messageId) ?? "" });
	}
}
