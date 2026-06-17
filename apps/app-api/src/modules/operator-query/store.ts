import type { Env } from "../../config";
import { createRuntimeDbGetter } from "../../db/runtime";
import type { OperatorQueryStore } from "./service";
import { createEvalCoverageStoreHandlers } from "./store/eval-coverage";
import { createMetricStoreHandlers } from "./store/metrics";
import { createRequestStoreHandlers } from "./store/requests";
import type { RuntimeDbGetter } from "./store/runtime";
import { createRuntimeOpsStoreHandlers } from "./store/runtime-ops";

export function createPgOperatorQueryStore(
	env: Env,
	input: {
		getDb?: RuntimeDbGetter;
		now?: () => Date;
	} = {},
): OperatorQueryStore {
	const getDb = input.getDb ?? createRuntimeDbGetter(env);
	const now = input.now ?? (() => new Date());

	return {
		...createEvalCoverageStoreHandlers({ getDb, now }),
		...createRequestStoreHandlers({ getDb, now }),
		...createMetricStoreHandlers({ getDb, now }),
		...createRuntimeOpsStoreHandlers({ getDb, now }),
	};
}
