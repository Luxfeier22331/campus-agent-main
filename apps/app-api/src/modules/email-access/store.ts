import type { RuntimeDbGetter } from "../../db/runtime";
import { createEmailAccessGrantStoreContext } from "./store-context";
import type { EmailAccessGrantStore } from "./store-contract";
import { createEmailAccessGrantIssuanceOperations } from "./store-issuance-operations";
import { createEmailAccessGrantReadOperations } from "./store-read-operations";
import { createEmailAccessGrantRevocationOperations } from "./store-revocation-operations";

export type { EmailAccessGrantStore } from "./store-contract";

export function createPgEmailAccessGrantStore(input: {
	getDb: RuntimeDbGetter;
}): EmailAccessGrantStore {
	const context = createEmailAccessGrantStoreContext(input);
	return {
		...createEmailAccessGrantReadOperations(context),
		...createEmailAccessGrantIssuanceOperations(context),
		...createEmailAccessGrantRevocationOperations(context),
	};
}
