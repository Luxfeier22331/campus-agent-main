package execution

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
	contractsv1 "github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/contracts"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/runtimepolicy"
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
	RequestID           string
	TraceID             string
	RequestedCapability string
	Lane                string
	RuntimeDecisions    RuntimeDecisionSummary
	StructuredHandoff   *RuntimeHandoff
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
	SelectedTarget         string
	SelectedTool           string
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
		"selected_target":          s.SelectedTarget,
		"selected_tool":            s.SelectedTool,
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
	Target                 string
	PayloadKind            string
	Payload                map[string]any
	AllowedTools           []string
	RequiredProjectionKind string
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

type profileMemoryItem struct {
	ItemID         string
	Key            string
	Value          string
	SourceType     string
	Confidence     string
	Visibility     string
	LastVerifiedAt string
}

type sessionSlot struct {
	Name      string
	Value     string
	Confirmed bool
}

type selectedNoticeRef struct {
	NoticeID     string
	SourceFamily string
	Title        string
}

type contextProjection struct {
	Actor             actorContext
	Authorization     authorizationProjection
	ProfileMemory     []profileMemoryItem
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
	requestID, err := parseOptionalString(payload["request_id"])
	if err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}
	if requestID == "" {
		return AnswerExecutionRequest{}, &HTTPError{
			Status:    400,
			Code:      "missing_request_id",
			Message:   "request_id is required for supervisor execution lifecycle tracking.",
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

	requestedCapability, err := parseOptionalString(payload["requested_capability"])
	if err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}
	if requestedCapability != "" && !isAllowedRequestedCapability(requestedCapability) {
		return AnswerExecutionRequest{}, invalidRequest(
			fmt.Sprintf("unsupported requested_capability: %s", requestedCapability),
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
	if err := validateCapabilityEnvelope(
		requestedCapability,
		hasRequestedScope,
		versionQuery,
	); err != nil {
		return AnswerExecutionRequest{}, invalidRequest(err.Error())
	}
	if hasRequestedScope {
		scopeAllowed, err := runtimepolicy.QueryScopeAllowed(
			requestedScope.Corpus,
			requestedScope.Collection,
			cfg.QueryServingScopesPath,
		)
		if err != nil {
			return AnswerExecutionRequest{}, &HTTPError{
				Status:    500,
				Code:      "query_scope_policy_unavailable",
				Message:   "Knowledge query-serving scope policy could not be loaded.",
				Retryable: false,
			}
		}
		if !scopeAllowed {
			return AnswerExecutionRequest{}, &HTTPError{
				Status: 403,
				Code:   "disallowed_knowledge_scope",
				Message: fmt.Sprintf(
					"knowledge scope %s/%s is not query-enabled",
					requestedScope.Corpus,
					requestedScope.Collection,
				),
			}
		}
	}
	capabilityResolution := runtimepolicy.ResolveCapability(
		runtimepolicy.CapabilityResolutionRequest{
			RequestedCapability: requestedCapability,
			UserGoal:            userGoal,
			HasRequestedScope:   hasRequestedScope,
			VersionQueryMode:    versionQuery.Mode,
		},
		intentPolicy,
	)
	effectiveRequestedCapability := capabilityResolution.EffectiveCapability
	capabilitySource := capabilityResolution.Source

	traceID := strings.TrimSpace(headers["x-trace-id"])
	if traceID == "" {
		traceID = newTraceID()
	}

	runtimeDecisionPayload, runtimeDecisionSummary, structuredHandoff, terminalEnvelope := runtimeDecisions(
		effectiveRequestedCapability,
		capabilitySource,
		laneForCapability(effectiveRequestedCapability),
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

	bridgePayload := map[string]any{
		"bridge_version":       contractsv1.BridgeVersion,
		"response_contract":    contractsv1.ResponseContract,
		"user_goal":            userGoal,
		"conversation_id":      conversationID,
		"request_id":           requestID,
		"effective_capability": effectiveRequestedCapability,
		"lane":                 laneForCapability(effectiveRequestedCapability),
		"requested_capability": effectiveRequestedCapability,
		"trace": map[string]any{
			"trace_id": traceID,
		},
		"actor":   actor.toMap(),
		"context": context.toMap(),
		"version_query": map[string]any{
			"mode":                  versionQuery.Mode,
			"as_of":                 versionQuery.AsOf,
			"version_id":            versionQuery.VersionID,
			"compare_to_version_id": versionQuery.CompareToVersionID,
		},
		"runtime_decisions": runtimeDecisionPayload,
	}
	if safetyIdentifier != "" {
		bridgePayload["safety_identifier"] = safetyIdentifier
	}
	if hasRequestedScope {
		bridgePayload["requested_scope"] = map[string]any{
			"corpus":     requestedScope.Corpus,
			"collection": requestedScope.Collection,
		}
	}

	bridgeJSON, marshalErr := json.Marshal(bridgePayload)
	if marshalErr != nil {
		return AnswerExecutionRequest{}, &HTTPError{
			Status:    500,
			Code:      "bridge_request_encode_failed",
			Message:   "Supervisor bridge request could not be encoded.",
			Retryable: false,
		}
	}

	return AnswerExecutionRequest{
		Payload:             bridgeJSON,
		RequestID:           requestID,
		TraceID:             traceID,
		RequestedCapability: effectiveRequestedCapability,
		Lane:                laneForCapability(effectiveRequestedCapability),
		RuntimeDecisions:    runtimeDecisionSummary,
		StructuredHandoff:   structuredHandoff,
		WorkflowMode:        runtimeDecisionSummary.WorkflowMode,
		WorkflowPlanID:      runtimeDecisionSummary.WorkflowPlanID,
		PlannedHandoffs:     runtimeDecisionSummary.PlannedHandoffs,
		TerminalEnvelope:    terminalEnvelope,
		NoticeAccessContext: context.noticeAccessContextMap(),
	}, nil
}

func laneForCapability(requestedCapability string) string {
	switch requestedCapability {
	case "", "knowledge":
		return "rag"
	case "place_lookup":
		return "navigation"
	case "campus_services":
		return "campus_services"
	case "academic_calendar":
		return "academic_calendar"
	case "notice":
		return "notice"
	default:
		return "default"
	}
}

func isAllowedRequestedCapability(requestedCapability string) bool {
	switch requestedCapability {
	case "knowledge", "place_lookup", "campus_services", "academic_calendar", "notice":
		return true
	default:
		return false
	}
}

func validateCapabilityEnvelope(
	requestedCapability string,
	hasRequestedScope bool,
	versionQuery versionQuery,
) error {
	if requestedCapability == "" || requestedCapability == "knowledge" {
		return nil
	}
	if hasRequestedScope {
		if requestedCapability == "campus_services" {
			return nil
		}
		if requestedCapability == "place_lookup" {
			return fmt.Errorf("requested_scope is not allowed for place_lookup requests")
		}
		return fmt.Errorf("requested_scope is only allowed for knowledge requests")
	}
	if versionQuery.Mode != "" && versionQuery.Mode != "current" {
		if requestedCapability == "place_lookup" {
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
