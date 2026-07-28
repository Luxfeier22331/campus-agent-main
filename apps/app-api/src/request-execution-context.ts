import { AsyncLocalStorage } from "node:async_hooks";

export interface AppApiExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
}

const executionContextStorage = new AsyncLocalStorage<AppApiExecutionContext>();

export function runWithAppApiExecutionContext<T>(
	context: AppApiExecutionContext | undefined,
	callback: () => T,
): T {
	return context ? executionContextStorage.run(context, callback) : callback();
}

export function getAppApiExecutionContext(): AppApiExecutionContext | undefined {
	return executionContextStorage.getStore();
}
