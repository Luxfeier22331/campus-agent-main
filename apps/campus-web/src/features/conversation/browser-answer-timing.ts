// One foreground submission, owned by its conversation coordinator. No history
// replay, persisted queue, retry, or raw text is included in the report.
export class BrowserAnswerTiming {
	private sample: { startedAt: number; requestId?: string; firstDeltaMs?: number } | null = null;
	private observer: MutationObserver | null = null;
	private frame: number | null = null;

	start(): void {
		this.cancel();
		if (document.visibilityState !== "visible") {
			return;
		}
		this.sample = { startedAt: performance.now() };
		document.addEventListener("visibilitychange", this.onVisibilityChange);
	}

	accept(requestId: string): void {
		if (this.sample && !this.sample.requestId) {
			this.sample.requestId = requestId;
		}
	}

	receive(requestId: string | undefined, messageId: string): void {
		const sample = this.sample;
		if (
			!(sample && requestId) ||
			sample.requestId !== requestId ||
			sample.firstDeltaMs !== undefined
		) {
			return;
		}
		if (document.visibilityState !== "visible") {
			this.cancel();
			return;
		}
		sample.firstDeltaMs = performance.now() - sample.startedAt;
		const checkTextCommit = () => {
			const text = document.querySelector(`[data-answer-message-id="${CSS.escape(messageId)}"]`);
			if (!text?.textContent?.trim()) {
				return;
			}
			this.observer?.disconnect();
			this.observer = null;
			// The text has committed. Two frames provide a paint opportunity,
			// not a claim that the person has read the answer.
			this.frame = requestAnimationFrame(() => {
				this.frame = requestAnimationFrame(() => {
					if (this.sample !== sample || document.visibilityState !== "visible") {
						return;
					}
					const timing = {
						firstDeltaMs: sample.firstDeltaMs,
						firstRenderMs: performance.now() - sample.startedAt,
					};
					this.cancel();
					void fetch(`/api/chat/requests/${encodeURIComponent(requestId)}/client-timing`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(timing),
						keepalive: true,
					})
						.then((response) => {
							if (!response.ok) {
								console.warn("client_timing_rejected", { requestId, status: response.status });
							}
						})
						.catch(() => console.warn("client_timing_transport_failed", { requestId }));
				});
			});
		};
		this.observer = new MutationObserver(checkTextCommit);
		this.observer.observe(document.body, { childList: true, characterData: true, subtree: true });
		checkTextCommit();
	}

	cancel(): void {
		this.sample = null;
		this.observer?.disconnect();
		this.observer = null;
		if (this.frame !== null) {
			cancelAnimationFrame(this.frame);
		}
		this.frame = null;
		if (typeof document !== "undefined") {
			document.removeEventListener("visibilitychange", this.onVisibilityChange);
		}
	}

	private readonly onVisibilityChange = () => {
		if (document.visibilityState !== "visible") {
			this.cancel();
		}
	};
}
