// @vitest-environment node

import { registerOperatorQueryIntentSuite } from "./operator-query.route.intent.suite";
import { registerOperatorQueryObservabilitySuite } from "./operator-query.route.observability.suite";
import { registerOperatorQueryQualitySuite } from "./operator-query.route.quality.suite";
import { registerOperatorQueryRequestDetailSuite } from "./operator-query.route.request-detail.suite";
import { registerOperatorQueryRequestsListSuite } from "./operator-query.route.requests-list.suite";
import { registerOperatorQuerySafetyCostAuditSuite } from "./operator-query.route.safety-cost-audit.suite";

registerOperatorQueryRequestsListSuite();
registerOperatorQueryRequestDetailSuite();
registerOperatorQueryObservabilitySuite();
registerOperatorQueryIntentSuite();
registerOperatorQueryQualitySuite();
registerOperatorQuerySafetyCostAuditSuite();
