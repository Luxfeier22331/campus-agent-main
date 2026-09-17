import { BrowserAnswerTiming } from "./browser-answer-timing";

export interface ActiveRun {
	conversationId?: string | undefined;
	requestId: string;
	sequence?: number | undefined;
}

export interface RuntimeOperationIdentity {
	id: number;
	controller: AbortController;
}

export type RunCancellationState =
	| { phase: "idle" }
	| { localMessageId: string; operationId: number; phase: "initializing" }
	| { operationId: number; phase: "awaiting_request_id" }
	| { operationId: number; phase: "requesting"; promise: Promise<void>; requestId: string }
	| { operationId: number; phase: "acknowledged"; requestId: string };

export class RunOperationMachine {
	readonly clientTiming = new BrowserAnswerTiming();
	activeRun: ActiveRun | null = null;
	cancelFailure: { operationId: number; requestId: string } | null = null;
	cancellation: RunCancellationState = { phase: "idle" };
	controller: AbortController | null = null;
	operationId = 0;
	recovering = false;
	private automaticallyResumedRequestId: string | null = null;

	claimAutomaticResume(requestId: string): boolean {
		if (this.automaticallyResumedRequestId === requestId) {
			return false;
		}
		this.automaticallyResumedRequestId = requestId;
		return true;
	}

	start(): RuntimeOperationIdentity {
		this.recovering = false;
		this.controller?.abort();
		this.cancellation = { phase: "idle" };
		this.cancelFailure = null;
		const controller = new AbortController();
		this.controller = controller;
		this.operationId += 1;
		return { controller, id: this.operationId };
	}

	begin(controller = new AbortController()): RuntimeOperationIdentity {
		this.recovering = false;
		this.controller?.abort();
		this.cancellation = { phase: "idle" };
		this.cancelFailure = null;
		this.controller = controller;
		this.operationId += 1;
		return { controller, id: this.operationId };
	}

	current(): RuntimeOperationIdentity | null {
		return this.controller ? { controller: this.controller, id: this.operationId } : null;
	}

	ownedBy(operation: RuntimeOperationIdentity): boolean {
		return this.operationId === operation.id && this.controller === operation.controller;
	}

	clearController(operation: RuntimeOperationIdentity): void {
		if (this.ownedBy(operation)) {
			this.controller = null;
		}
	}

	invalidate(): void {
		this.clientTiming.cancel();
		this.recovering = false;
		this.operationId += 1;
		this.controller?.abort();
		this.controller = null;
		this.activeRun = null;
		this.cancelFailure = null;
		this.cancellation = { phase: "idle" };
	}

	replaceActiveRun(run: ActiveRun | null): void {
		this.activeRun = run;
	}

	updateActiveRun(update: (current: ActiveRun | null) => ActiveRun | null): void {
		this.activeRun = update(this.activeRun);
	}
}
