// @vitest-environment node

import { registerOperatorQueryIntentSuite } from "./operator-query.route.intent.suite";
import { registerOperatorQueryLangfuseEvalBacklinksSuite } from "./operator-query.route.langfuse-eval-backlinks.suite";
import { registerOperatorQueryObservabilitySuite } from "./operator-query.route.observability.suite";
import { registerOperatorQueryQualitySuite } from "./operator-query.route.quality.suite";
import { registerOperatorQueryRequestDetailSuite } from "./operator-query.route.request-detail.suite";
import { registerOperatorQueryRequestsListSuite } from "./operator-query.route.requests-list.suite";
import { registerOperatorQueryRuntimeHealthSuite } from "./operator-query.route.runtime-health.suite";
import { registerOperatorQueryRuntimeOpsSuite } from "./operator-query.route.runtime-ops.suite";
import { registerOperatorQuerySafetyCostAuditSuite } from "./operator-query.route.safety-cost-audit.suite";

registerOperatorQueryRequestsListSuite();
registerOperatorQueryRequestDetailSuite();
registerOperatorQueryObservabilitySuite();
registerOperatorQueryRuntimeHealthSuite();
registerOperatorQueryRuntimeOpsSuite();
registerOperatorQueryIntentSuite();
registerOperatorQueryLangfuseEvalBacklinksSuite();
registerOperatorQueryQualitySuite();
registerOperatorQuerySafetyCostAuditSuite();
