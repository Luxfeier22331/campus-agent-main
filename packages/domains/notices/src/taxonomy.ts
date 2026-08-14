export {
	NOTICE_DOMAIN_LABELS,
	NOTICE_DOMAINS,
	type NoticeDomain,
} from "campus-contracts/notices";

import { NOTICE_DOMAINS, type NoticeDomain } from "campus-contracts/notices";

const NOTICE_DOMAIN_SET = new Set<string>(NOTICE_DOMAINS);

export function isNoticeDomain(value: unknown): value is NoticeDomain {
	return typeof value === "string" && NOTICE_DOMAIN_SET.has(value);
}
