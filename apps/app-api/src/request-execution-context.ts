import { AsyncLocalStorage } from "node:async_hooks";
import { safeRuntimeFailure } from "./runtime-diagnostics";

export interface AppApiExecutionContext {
	waitUntil(promise: Promise<unknown>): void;
}

const executionContextStorage = new AsyncLocalStorage<AppApiExecutionContext>();

export function runWithAppApiExecutionContext<T>(
	context: AppApiExecutionContext | undefined,
	callback: () => T,
): T {
	return context
		? executionContextStorage.run(
				{
					waitUntil(promise) {
						context.waitUntil(
							promise.catch((error: unknown) => {
								throw safeRuntimeFailure(error, "app-api.background");
							}),
						);
					},
				},
				callback,
			)
		: callback();
}

export function getAppApiExecutionContext(): AppApiExecutionContext | undefined {
	return executionContextStorage.getStore();
}
