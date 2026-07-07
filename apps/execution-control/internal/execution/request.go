package execution

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/config"
	contractsv1 "github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/execution-control/internal/runtimepolicy"
)

const defaultPolicyProjectionVersion = "phase1-authorization-projection-v1"
const RuntimeDecisionsSchemaVersion = contractsv1.RuntimeDecisionsSchemaVersion
const RuntimeDecisionSummarySchemaVersion = contractsv1.RuntimeDecisionSummarySchemaVersion

type HTTPError struct {
	Status    int
	Code      string
	Message   string
	Retryable bool
}

type AnswerExecutionRequest struct {
	Payload             json.RawMessage
	ConversationID      string
	OwnerUserID         string
	RequestID           string
	TraceID             string
	RequestedTool       string
	TaskQueue           string
	RuntimeDecisions    RuntimeDecisionSummary
	ToolHandoff         *RuntimeHandoff
	WorkflowMode        WorkflowMode
	WorkflowPlanID      string
	PlannedHandoffs     []RuntimeHandoff
	TerminalEnvelope    map[string]any
	NoticeAccessContext map[string]any
}

type RuntimeDecisionSummary struct {
	ScopeGateDecision      string
	PolicyGateDecision     string
	ContextPreflightState  string
	RoutingNextAction      string
	PlanningOutcome        string
	WorkflowMode           WorkflowMode
	WorkflowPlanID         string
	SelectedTool           string
	TaskQueue              string
	TerminalOutcome        string
	FailCloseReason        string
	RuntimeVersions        map[string]any
	PolicyArtifactVersions map[string]any
	PlannedHandoffs        []RuntimeHandoff
}

func (s RuntimeDecisionSummary) Map() map[string]any {
	return map[string]any{
		"schema_version":           RuntimeDecisionSummarySchemaVersion,
		"scope_gate_decision":      s.ScopeGateDecision,
		"policy_gate_decision":     s.PolicyGateDecision,
		"context_preflight_state":  s.ContextPreflightState,
		"routing_next_action":      s.RoutingNextAction,
		"planning_outcome":         s.PlanningOutcome,
		"selected_tool":            s.SelectedTool,
		"task_queue":               s.TaskQueue,
		"terminal_outcome":         s.TerminalOutcome,
		"fail_close_reason":        s.FailCloseReason,
		"runtime_versions":         cloneAnyMap(s.RuntimeVersions),
		"policy_artifact_versions": cloneAnyMap(s.PolicyArtifactVersions),
	}
}

func cloneAnyMap(source map[string]any) map[string]any {
	if source == nil {
		return map[string]any{}
	}
	clone := make(map[string]any, len(source))
	for key, value := range source {
		clone[key] = value
	}
	return clone
}

type RuntimeHandoff struct {
	ToolTarget             string
	TaskQueue              string
	PayloadKind            string
	Payload                map[string]any
	AllowedTools           []string
	RequiredProjectionKind string
	ExpectedArtifacts      []string
}

type actorContext struct {
	UserID        string
	PrincipalID   string
	PrincipalType string
	Roles         []string
	Departments   []string
	Cohort        string
	Major         string
	Program       string
}

type authorizedRetrievalFilter struct {
	EntitlementGroups     []string
	VisibilityLevel       string
	VisibilityScope       string
	PolicyProjectionValue string
}

type authorizationProjection struct {
	PrincipalID           string
	ProjectionSource      string
	EntitlementSnapshotID string
	EntitlementGroups     []string
	VisibilityScope       string
	ApplicaibilityScope   string
	OwnershipScopes       []string
	ApprovalState         string
	RetrievalFilter       authorizedRetrievalFilter
}

type sessionSlot struct {
	Name      string
	Value     string
	Confirmed bool
}

type selectedNoticeRef struct {
	NoticeID      string
	SourceFamily  string
	Title         string
	TargetSurface string
}

type contextProjection struct {
	Actor             actorContext
	Authorization     authorizationProjection
	Conversation      map[string]any
	MemoryEnabled     *bool
	SessionSlots      []sessionSlot
	SelectedNoticeRef selectedNoticeRef
	TurnCount         int
}

type knowledgeScope struct {
	Corpus     string
	Collection string
}

type versionQuery struct {
	Mode               string
	AsOf               string
	VersionID          string
	CompareToVersionID string
}

func ParseAnswerRequest(
	body json.RawMessage,
	headers map[string]string,
	cfg config.Config,
) (AnswerExecutionRequest, *HTTPError) {
	intentPolicy, intentPolicyErr := runtimepolicy.LoadIntentPolicy(cfg.IntentPolicyPath)
	return ParseAnswerRequestWithIntentPolicy(body, headers, cfg, intentPolicy, intentPolicyErr)
}

func ParseAnswerRequestWithIntentPolicy(
	body json.RawMessage,
	headers map[string]string,
	cfg config.Config,
	intentPolicy runtimepolicy.IntentPolicyArtifact,
	intentPolicyErr error,
) (AnswerExecutionRequest, *HTTPError) {
	payload, err := parseObject(body, "request body")
	if err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}

	authenticatedActor, httpErr := authenticate(headers, cfg)
	if httpErr != nil {
		return AnswerExecutionRequest{}, httpErr
	}

	bodyActor, hasBodyActor, err := parseRequestActor(payload["actor"], cfg.AuthMode)
	if err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}
	bodyContext, hasBodyContext, err := parseContextProjection(payload["context"], cfg.AuthMode)
	if err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}

	actor, context, err := resolveRequestIdentityProjection(
		authenticatedActor,
		bodyActor,
		hasBodyActor,
		bodyContext,
		hasBodyContext,
		cfg.AuthMode,
	)
	if err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}

	userGoal, err := requireString(payload["user_goal"], "user_goal")
	if err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}
	conversationID, err := parseOptionalString(payload["conversation_id"])
	if err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}
	if err := context.validateConversationIdentity(conversationID); err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}
	tenantID, err := parseOptionalString(payload["tenant_id"])
	if err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}
	if context.MemoryEnabled != nil && *context.MemoryEnabled && tenantID == "" {
		return AnswerExecutionRequest{}, invalidRequest("tenant_id is required when context.memory.enabled is true")
	}
	requestID, err := parseOptionalString(payload["request_id"])
	if err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}
	if requestID == "" {
		return AnswerExecutionRequest{}, &HTTPError{
			Status:    400,
			Code:      "missing_request_id",
			Message:   "request_id is required for execution lifecycle tracking.",
			Retryable: false,
		}
	}
	safetyIdentifier, err := parseOptionalString(payload["safety_identifier"])
	if err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}
	if safetyIdentifier != "" && !isLowerHex64(safetyIdentifier) {
		return AnswerExecutionRequest{}, invalidRequest(
			"safety_identifier must be a 64-character lowercase hex string",
		)
	}

	requestedTool, err := parseOptionalString(payload["requested_tool"])
	if err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}
	if requestedTool != "" && !isAllowedRequestedTool(requestedTool) {
		return AnswerExecutionRequest{}, invalidRequest(
			fmt.Sprintf("unsupported requested_tool: %s", requestedTool),
		)
	}

	requestedScope, hasRequestedScope, err := parseRequestedScope(payload["requested_scope"])
	if err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}
	versionQuery, err := parseVersionQuery(payload["version_query"])
	if err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}
	freshnessIntent, err := parseOptionalString(payload["freshness_intent"])
	if err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}
	if err := validateToolEnvelope(
		requestedTool,
		hasRequestedScope,
		versionQuery,
	); err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}
	if hasRequestedScope {
		admission, err := runtimepolicy.AdmitQueryScope(runtimepolicy.QueryScopeAdmissionRequest{
			Collection:      requestedScope.Collection,
			Corpus:          requestedScope.Corpus,
			FreshnessIntent: freshnessIntent,
			QueryMode:       versionQuery.Mode,
		}, cfg.QueryServingScopesPath)
		if err != nil {
			return AnswerExecutionRequest{}, &HTTPError{
				Status:    500,
				Code:      "query_scope_policy_unavailable",
				Message:   "Knowledge query-serving scope policy could not be loaded.",
				Retryable: false,
			}
		}
		if !admission.Allowed {
			return AnswerExecutionRequest{}, &HTTPError{
				Status: 403,
				Code:   "disallowed_knowledge_scope",
				Message: fmt.Sprintf(
					"knowledge scope %s/%s is not admitted for this query",
					requestedScope.Corpus,
					requestedScope.Collection,
				),
			}
		}
	}
	admissionTarget := toolAdmissionTargetForRequest(requestedTool, hasRequestedScope, versionQuery)
	taskQueue := taskQueueForToolTarget(admissionTarget)

	traceID := strings.TrimSpace(headers["x-trace-id"])
	if traceID == "" {
		traceID = newTraceID()
	}

	runtimeDecisionPayload, runtimeDecisionSummary, toolHandoff, terminalEnvelope := runtimeDecisions(
		admissionTarget,
		taskQueue,
		userGoal,
		conversationID,
		requestID,
		safetyIdentifier,
		traceID,
		actor,
		hasRequestedScope,
		requestedScope,
		versionQuery,
		context,
		cfg.MultiStepWorkflowEnabled,
		intentPolicy,
		intentPolicyErr,
	)

	executionPayload := map[string]any{
		"execution_contract_version": contractsv1.ExecutionContractVersion,
		"response_contract":          contractsv1.ResponseContract,
		"user_goal":                  userGoal,
		"conversation_id":            conversationID,
		"request_id":                 requestID,
		"effective_tool":             admissionTarget,
		"tool_admission_target":      admissionTarget,
		"task_queue":                 taskQueue,
		"tenant_id":                  tenantID,
		"trace": map[string]any{
			"trace_id": traceID,
		},
		"actor":      actor.toMap(),
		"context":    context.toMap(),
		"query_mode": versionQuery.Mode,
		"version_query": map[string]any{
			"mode":                  versionQuery.Mode,
			"as_of":                 versionQuery.AsOf,
			"version_id":            versionQuery.VersionID,
			"compare_to_version_id": versionQuery.CompareToVersionID,
		},
		"runtime_decisions": runtimeDecisionPayload,
	}
	if safetyIdentifier != "" {
		executionPayload["safety_identifier"] = safetyIdentifier
	}
	if admissionTarget != "" {
		executionPayload["requested_tool"] = admissionTarget
	}
	if hasRequestedScope {
		executionPayload["requested_scope"] = map[string]any{
			"corpus":     requestedScope.Corpus,
			"collection": requestedScope.Collection,
		}
	}
	if freshnessIntent != "" {
		executionPayload["freshness_intent"] = freshnessIntent
	}

	payloadJSON, marshalErr := json.Marshal(executionPayload)
	if marshalErr != nil {
		return AnswerExecutionRequest{}, &HTTPError{
			Status:    500,
			Code:      "execution_request_encode_failed",
			Message:   "Execution request could not be encoded.",
			Retryable: false,
		}
	}

	return AnswerExecutionRequest{
		Payload:             payloadJSON,
		ConversationID:      conversationID,
		OwnerUserID:         actor.UserID,
		RequestID:           requestID,
		TraceID:             traceID,
		RequestedTool:       admissionTarget,
		TaskQueue:           taskQueue,
		RuntimeDecisions:    runtimeDecisionSummary,
		ToolHandoff:         toolHandoff,
		WorkflowMode:        runtimeDecisionSummary.WorkflowMode,
		WorkflowPlanID:      runtimeDecisionSummary.WorkflowPlanID,
		PlannedHandoffs:     runtimeDecisionSummary.PlannedHandoffs,
		TerminalEnvelope:    terminalEnvelope,
		NoticeAccessContext: context.noticeAccessContextMap(),
	}, nil
}

func toolAdmissionTargetForRequest(
	requestedTool string,
	hasRequestedScope bool,
	versionQuery versionQuery,
) string {
	normalized := strings.TrimSpace(requestedTool)
	if normalized != "" {
		return normalized
	}
	if hasRequestedScope || (versionQuery.Mode != "" && versionQuery.Mode != "current") {
		return "knowledge_query"
	}
	return ""
}

func taskQueueForToolTarget(string) string {
	return "campus-agent.workflow"
}

func isAllowedRequestedTool(requestedTool string) bool {
	switch requestedTool {
	case "knowledge_query",
		"place_lookup",
		"public_web_search",
		"transport_schedule_lookup",
		"campus_notice_discover":
		return true
	default:
		return false
	}
}

func validateToolEnvelope(
	requestedTool string,
	hasRequestedScope bool,
	versionQuery versionQuery,
) error {
	if requestedTool == "" || requestedTool == "knowledge_query" {
		return nil
	}
	if hasRequestedScope {
		if requestedTool == "place_lookup" {
			return fmt.Errorf("requested_scope is not allowed for place_lookup requests")
		}
		return fmt.Errorf("requested_scope is only allowed for knowledge requests")
	}
	if versionQuery.Mode != "" && versionQuery.Mode != "current" {
		if requestedTool == "place_lookup" {
			return fmt.Errorf("version_query is not allowed for place_lookup requests")
		}
		return fmt.Errorf("version_query is only allowed for knowledge requests")
	}
	return nil
}

func authenticate(headers map[string]string, cfg config.Config) (actorContext, *HTTPError) {
	switch cfg.AuthMode {
	case "bearer":
		token := extractBearerToken(headers["authorization"])
		expectedToken := strings.TrimSpace(cfg.BearerToken)
		if expectedToken == "" {
			return actorContext{}, &HTTPError{
				Status:  500,
				Code:    "auth_not_configured",
				Message: "Bearer auth requires API_BEARER_TOKEN.",
			}
		}
		if token != "" && subtle.ConstantTimeCompare([]byte(token), []byte(expectedToken)) != 1 {
			return actorContext{}, &HTTPError{
				Status:  401,
				Code:    "unauthorized",
				Message: "Invalid bearer token.",
			}
		}
		if token == "" {
			return actorContext{}, &HTTPError{
				Status:  401,
				Code:    "unauthorized",
				Message: "Missing bearer token.",
			}
		}
		if strings.TrimSpace(cfg.DefaultActorID) == "" {
			return actorContext{}, &HTTPError{
				Status:  500,
				Code:    "auth_not_configured",
				Message: "Bearer auth requires API_DEFAULT_ACTOR_ID.",
			}
		}
		return actorContext{
			UserID: strings.TrimSpace(cfg.DefaultActorID),
			Roles:  slices.Clone(cfg.DefaultActorRoles),
		}, nil
	case "trusted-worker":
		sharedSecret := strings.TrimSpace(cfg.WorkerSharedSecret)
		if sharedSecret == "" {
			return actorContext{}, &HTTPError{
				Status:  401,
				Code:    "unauthorized",
				Message: "Trusted worker auth is not configured.",
			}
		}
		presented := strings.TrimSpace(headers["x-worker-origin-auth"])
		if presented == "" {
			return actorContext{}, &HTTPError{
				Status:  401,
				Code:    "unauthorized",
				Message: "Missing worker origin auth.",
			}
		}
		if subtle.ConstantTimeCompare([]byte(presented), []byte(sharedSecret)) != 1 {
			return actorContext{}, &HTTPError{
				Status:  401,
				Code:    "unauthorized",
				Message: "Invalid worker origin auth.",
			}
		}
		return actorContext{}, nil
	default:
		return actorContext{}, &HTTPError{
			Status:  401,
			Code:    "unsupported_auth_mode",
			Message: "Unsupported auth mode.",
		}
	}
}

func resolveRequestIdentityProjection(
	authenticatedActor actorContext,
	bodyActor actorContext,
	hasBodyActor bool,
	bodyContext contextProjection,
	hasBodyContext bool,
	authMode string,
) (actorContext, contextProjection, error) {
	if authMode == "trusted-worker" {
		if !hasBodyContext {
			return actorContext{}, contextProjection{}, fmt.Errorf("trusted-worker requests must provide context")
		}
		if !hasBodyActor && bodyContext.Actor.isZero() {
			return actorContext{}, contextProjection{}, fmt.Errorf("context.actor is required in trusted-worker mode")
		}
		if hasBodyActor && bodyContext.Actor.isZero() {
			bodyContext.Actor = bodyActor
		}
		if hasBodyActor && !bodyContext.Actor.equal(bodyActor) {
			return actorContext{}, contextProjection{}, fmt.Errorf("actor and context.actor must match")
		}
		if hasBodyActor {
			return bodyActor, bodyContext, nil
		}
		return bodyContext.Actor, bodyContext, nil
	}

	if !hasBodyActor && !hasBodyContext {
		return authenticatedActor, newDefaultContextProjection(authenticatedActor), nil
	}
	if !hasBodyContext {
		return bodyActor, newDefaultContextProjection(bodyActor), nil
	}
	if !hasBodyActor {
		return bodyContext.Actor, bodyContext, nil
	}
	if bodyContext.Actor.isZero() {
		authorization := bodyContext.Authorization
		if authorization.isZero() {
			authorization = newDefaultAuthorizationProjection(bodyActor)
		}
		bodyContext.Actor = bodyActor
		bodyContext.Authorization = authorization
	}
	if !bodyContext.Actor.equal(bodyActor) {
		return actorContext{}, contextProjection{}, fmt.Errorf("actor and context.actor must match")
	}
	return bodyActor, bodyContext, nil
}
