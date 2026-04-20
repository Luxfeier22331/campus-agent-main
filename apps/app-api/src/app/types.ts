import type { Env } from "../config";
import type {
  AppAuthGetter,
  AppAuthResolutionInput,
  ResolvedAppPrincipal,
} from "../modules/auth";
import type {
  ChatConversationService,
} from "../modules/chat";
import type {
  OfficialWebExecutionStatusService,
} from "../modules/official-web-execution";
import type {
  OfficialWebPlannerService,
} from "../modules/official-web-planner";
import type {
  OfficialWebQueryService,
} from "../modules/official-web-query";
import type {
  OfficialWebCommandService,
} from "../modules/official-web-command";
import type {
  OperatorObservabilityCommandService,
} from "../modules/operator-observability-command";
import type { OperatorQueryService } from "../modules/operator-query";
import type { ChatCommandService } from "../modules/runtime-command";
import type { AppTelemetry } from "../modules/telemetry";

export interface AppDependencies {
  authHandler?: (
    request: Request,
    env: Env,
    input?: AppAuthResolutionInput,
  ) => Promise<Response> | Response;
  chatConversationService?: ChatConversationService;
  chatCommandService?: ChatCommandService;
  getPrincipal?: (
    request: Request,
    env: Env,
    input?: AppAuthResolutionInput,
  ) => Promise<ResolvedAppPrincipal | null>;
  officialWebCommandService?: OfficialWebCommandService;
  officialWebExecutionStatusService?: OfficialWebExecutionStatusService;
  officialWebPlannerService?: OfficialWebPlannerService;
  officialWebQueryService?: OfficialWebQueryService;
  operatorObservabilityCommandService?: OperatorObservabilityCommandService;
  operatorQueryService?: OperatorQueryService;
  scheduleRequestProjectionDrain?: (input: {
    requestId: string;
    waitUntil?: ((promise: Promise<unknown>) => void) | undefined;
  }) => void;
  telemetry?: AppTelemetry;
  runtimeReadinessProbe?: () => Promise<AppRuntimeReadinessResult>;
}

type AppRuntimeDependencyName = "auth" | "database" | "supervisorApi";

export interface AppRuntimeReadinessResult {
  dependencies: {
    auth: "ready" | "not_ready";
    database: "ready" | "not_ready";
    officialWebHandoff: "configured" | "not_configured";
    operatorBridge: "configured";
    publicChatOrigin: "configured";
    supervisorApi: "ready" | "not_ready";
  };
  failed: Partial<Record<AppRuntimeDependencyName, string>>;
}

export interface AppRequestScope {
  getAppAuth: AppAuthGetter;
  resolveChatCommandService(): ChatCommandService;
  resolveChatConversationService(): ChatConversationService;
  resolveOfficialWebCommandService(): OfficialWebCommandService;
  resolveOfficialWebQueryService(): OfficialWebQueryService;
  resolveOperatorObservabilityCommandService(): OperatorObservabilityCommandService;
  resolveOperatorQueryService(): OperatorQueryService;
}
