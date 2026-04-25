package execution

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
	"strings"

	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/config"
	"github.com/MUC-WIKI/campus-agent/apps/supervisor-api/internal/runtimepolicy"
)

const defaultPolicyProjectionVersion = "phase1-authorization-projection-v1"

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
	TerminalEnvelope    map[string]any
	NoticeAccessContext map[string]any
}

type RuntimeDecisionSummary struct {
	ScopeGateDecision     string
	PolicyGateDecision    string
	ContextPreflightState string
	RoutingNextAction     string
	PlanningOutcome       string
	SelectedTarget        string
	SelectedTool          string
	TerminalOutcome       string
	FailCloseReason       string
}

func (s RuntimeDecisionSummary) Map() map[string]any {
	return map[string]any{
		"scope_gate_decision":     s.ScopeGateDecision,
		"policy_gate_decision":    s.PolicyGateDecision,
		"context_preflight_state": s.ContextPreflightState,
		"routing_next_action":     s.RoutingNextAction,
		"planning_outcome":        s.PlanningOutcome,
		"selected_target":         s.SelectedTarget,
		"selected_tool":           s.SelectedTool,
		"terminal_outcome":        s.TerminalOutcome,
		"fail_close_reason":       s.FailCloseReason,
	}
}

type RuntimeHandoff struct {
	Target       string
	PayloadKind  string
	Payload      map[string]any
	AllowedTools []string
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
	effectiveRequestedCapability := effectiveCapability(
		requestedCapability,
		userGoal,
		hasRequestedScope,
		versionQuery,
	)
	capabilitySource := effectiveCapabilitySource(
		requestedCapability,
		effectiveRequestedCapability,
		hasRequestedScope,
		versionQuery,
	)

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
	)

	bridgePayload := map[string]any{
		"bridge_version":       "supervisor_bridge_v6",
		"response_contract":    "agent_response",
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
	case "notice":
		return "notice"
	default:
		return "default"
	}
}

func isAllowedRequestedCapability(requestedCapability string) bool {
	switch requestedCapability {
	case "knowledge", "place_lookup", "campus_services", "notice":
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

func parseRequestActor(raw json.RawMessage, authMode string) (actorContext, bool, error) {
	if len(raw) == 0 {
		return actorContext{}, false, nil
	}
	if authMode != "trusted-worker" {
		return actorContext{}, false, fmt.Errorf("actor projection is only accepted in trusted-worker mode")
	}
	actor, err := parseActorContext(raw, "actor")
	return actor, true, err
}

func parseContextProjection(raw json.RawMessage, authMode string) (contextProjection, bool, error) {
	if len(raw) == 0 {
		return contextProjection{}, false, nil
	}
	if authMode != "trusted-worker" {
		return contextProjection{}, false, fmt.Errorf("context projection is only accepted in trusted-worker mode")
	}
	rawContext, err := parseObject(raw, "context")
	if err != nil {
		return contextProjection{}, false, fmt.Errorf("context must be an object")
	}

	projectedActor, err := parseActorContext(rawContext["actor"], "context.actor")
	if err != nil {
		return contextProjection{}, false, err
	}
	authorization, err := parseAuthorizationProjection(
		rawContext["authorization"],
		projectedActor,
		true,
	)
	if err != nil {
		return contextProjection{}, false, err
	}
	profileMemory, err := parseProfileMemorySummary(rawContext["profile_memory"])
	if err != nil {
		return contextProjection{}, false, err
	}
	sessionSlots, selectedNoticeRef, turnCount, err := parseSessionSummary(rawContext["session"])
	if err != nil {
		return contextProjection{}, false, err
	}

	return contextProjection{
		Actor:             projectedActor,
		Authorization:     authorization,
		ProfileMemory:     profileMemory,
		SessionSlots:      sessionSlots,
		SelectedNoticeRef: selectedNoticeRef,
		TurnCount:         turnCount,
	}, true, nil
}

func parseActorContext(raw json.RawMessage, fieldPrefix string) (actorContext, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return actorContext{}, nil
	}
	rawActor, err := parseObject(raw, fieldPrefix)
	if err != nil {
		return actorContext{}, fmt.Errorf("%s must be an object", fieldPrefix)
	}
	if err := assertSupportedFields(
		rawActor,
		[]string{
			"user_id",
			"principal_id",
			"principal_type",
			"roles",
			"departments",
			"cohort",
			"major",
			"program",
		},
		fieldPrefix,
		"unsupported actor context fields are not allowed: %s",
	); err != nil {
		return actorContext{}, err
	}

	roles, err := parseStringArray(rawActor["roles"], fieldPrefix+".roles")
	if err != nil {
		return actorContext{}, err
	}
	departments, err := parseStringArray(rawActor["departments"], fieldPrefix+".departments")
	if err != nil {
		return actorContext{}, err
	}
	userID, err := parseOptionalString(rawActor["user_id"])
	if err != nil {
		return actorContext{}, fmt.Errorf("%s.user_id must be a string", fieldPrefix)
	}
	principalID, err := parseOptionalString(rawActor["principal_id"])
	if err != nil {
		return actorContext{}, fmt.Errorf("%s.principal_id must be a string", fieldPrefix)
	}
	principalType, err := parseOptionalString(rawActor["principal_type"])
	if err != nil {
		return actorContext{}, fmt.Errorf("%s.principal_type must be a string", fieldPrefix)
	}
	cohort, err := parseOptionalString(rawActor["cohort"])
	if err != nil {
		return actorContext{}, fmt.Errorf("%s.cohort must be a string", fieldPrefix)
	}
	major, err := parseOptionalString(rawActor["major"])
	if err != nil {
		return actorContext{}, fmt.Errorf("%s.major must be a string", fieldPrefix)
	}
	program, err := parseOptionalString(rawActor["program"])
	if err != nil {
		return actorContext{}, fmt.Errorf("%s.program must be a string", fieldPrefix)
	}

	return actorContext{
		UserID:        userID,
		PrincipalID:   principalID,
		PrincipalType: principalType,
		Roles:         roles,
		Departments:   departments,
		Cohort:        cohort,
		Major:         major,
		Program:       program,
	}, nil
}

func parseAuthorizationProjection(
	raw json.RawMessage,
	actor actorContext,
	requireExplicitFilter bool,
) (authorizationProjection, error) {
	if len(raw) == 0 || string(raw) == "null" {
		if requireExplicitFilter {
			return authorizationProjection{}, fmt.Errorf("context.authorization is required")
		}
		return newDefaultAuthorizationProjection(actor), nil
	}
	rawAuthorization, err := parseObject(raw, "context.authorization")
	if err != nil {
		return authorizationProjection{}, fmt.Errorf("context.authorization must be an object")
	}

	entitlementGroups, err := parseStringArray(
		rawAuthorization["entitlement_groups"],
		"context.authorization.entitlement_groups",
	)
	if err != nil {
		return authorizationProjection{}, err
	}
	visibilityScope, err := parseOptionalString(rawAuthorization["visibility_scope"])
	if err != nil {
		return authorizationProjection{}, fmt.Errorf("context.authorization.visibility_scope must be a string")
	}
	projectionSource, err := parseOptionalString(rawAuthorization["projection_source"])
	if err != nil {
		return authorizationProjection{}, fmt.Errorf("context.authorization.projection_source must be a string")
	}
	entitlementSnapshotID, err := parseOptionalString(rawAuthorization["entitlement_snapshot_id"])
	if err != nil {
		return authorizationProjection{}, fmt.Errorf("context.authorization.entitlement_snapshot_id must be a string")
	}
	applicabilityScope, err := parseOptionalString(rawAuthorization["applicability_scope"])
	if err != nil {
		return authorizationProjection{}, fmt.Errorf("context.authorization.applicability_scope must be a string")
	}
	approvalState, err := parseOptionalString(rawAuthorization["approval_state"])
	if err != nil {
		return authorizationProjection{}, fmt.Errorf("context.authorization.approval_state must be a string")
	}
	ownershipScopes, err := parseStringArray(
		rawAuthorization["ownership_scopes"],
		"context.authorization.ownership_scopes",
	)
	if err != nil {
		return authorizationProjection{}, err
	}
	retrievalFilter, err := parseAuthorizedRetrievalFilter(
		rawAuthorization["retrieval_filter"],
		requireExplicitFilter,
	)
	if err != nil {
		return authorizationProjection{}, err
	}

	principalID, err := parseOptionalString(rawAuthorization["principal_id"])
	if err != nil {
		return authorizationProjection{}, fmt.Errorf("context.authorization.principal_id must be a string")
	}
	if principalID == "" {
		if actor.PrincipalID != "" {
			principalID = actor.PrincipalID
		} else {
			principalID = actor.UserID
		}
	}

	return authorizationProjection{
		PrincipalID:           principalID,
		ProjectionSource:      projectionSource,
		EntitlementSnapshotID: entitlementSnapshotID,
		EntitlementGroups:     entitlementGroups,
		VisibilityScope:       visibilityScope,
		ApplicaibilityScope:   applicabilityScope,
		OwnershipScopes:       ownershipScopes,
		ApprovalState:         approvalState,
		RetrievalFilter:       retrievalFilter,
	}, nil
}

func parseAuthorizedRetrievalFilter(
	raw json.RawMessage,
	requireExplicit bool,
) (authorizedRetrievalFilter, error) {
	if len(raw) == 0 || string(raw) == "null" {
		if requireExplicit {
			return authorizedRetrievalFilter{}, fmt.Errorf("context.authorization.retrieval_filter is required")
		}
		return authorizedRetrievalFilter{
			VisibilityLevel:       "public",
			PolicyProjectionValue: defaultPolicyProjectionVersion,
		}, nil
	}
	rawFilter, err := parseObject(raw, "context.authorization.retrieval_filter")
	if err != nil {
		return authorizedRetrievalFilter{}, fmt.Errorf("context.authorization.retrieval_filter must be an object")
	}
	if err := assertSupportedFields(
		rawFilter,
		[]string{
			"entitlement_groups",
			"visibility_level",
			"visibility_scope",
			"policy_projection_version",
		},
		"context.authorization.retrieval_filter",
		"unsupported retrieval filter fields are not allowed: %s",
	); err != nil {
		return authorizedRetrievalFilter{}, err
	}

	entitlementGroups, err := parseStringArray(
		rawFilter["entitlement_groups"],
		"context.authorization.retrieval_filter.entitlement_groups",
	)
	if err != nil {
		return authorizedRetrievalFilter{}, err
	}
	visibilityLevel, err := parseOptionalString(rawFilter["visibility_level"])
	if err != nil {
		return authorizedRetrievalFilter{}, fmt.Errorf(
			"context.authorization.retrieval_filter.visibility_level must be a string",
		)
	}
	if visibilityLevel == "" {
		visibilityLevel = "public"
	}
	visibilityScope, err := parseOptionalString(rawFilter["visibility_scope"])
	if err != nil {
		return authorizedRetrievalFilter{}, fmt.Errorf(
			"context.authorization.retrieval_filter.visibility_scope must be a string",
		)
	}
	policyProjectionVersion, err := parseOptionalString(rawFilter["policy_projection_version"])
	if err != nil {
		return authorizedRetrievalFilter{}, fmt.Errorf(
			"context.authorization.retrieval_filter.policy_projection_version must be a string",
		)
	}
	if policyProjectionVersion == "" {
		policyProjectionVersion = defaultPolicyProjectionVersion
	}

	return authorizedRetrievalFilter{
		EntitlementGroups:     entitlementGroups,
		VisibilityLevel:       visibilityLevel,
		VisibilityScope:       visibilityScope,
		PolicyProjectionValue: policyProjectionVersion,
	}, nil
}

func parseProfileMemorySummary(raw json.RawMessage) ([]profileMemoryItem, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	rawMemory, err := parseObject(raw, "context.profile_memory")
	if err != nil {
		return nil, fmt.Errorf("context.profile_memory must be an object")
	}
	if len(rawMemory["items"]) == 0 {
		return nil, nil
	}
	rawItems, err := parseArray(rawMemory["items"], "context.profile_memory.items")
	if err != nil {
		return nil, err
	}

	items := make([]profileMemoryItem, 0, len(rawItems))
	for _, rawItem := range rawItems {
		objectItem, err := parseObject(rawItem, "context.profile_memory.items[]")
		if err != nil {
			return nil, fmt.Errorf("context.profile_memory.items must only contain objects")
		}
		itemID, err := requireString(
			objectItem["item_id"],
			"context.profile_memory.items[].item_id",
		)
		if err != nil {
			return nil, err
		}
		key, err := requireString(objectItem["key"], "context.profile_memory.items[].key")
		if err != nil {
			return nil, err
		}
		value, err := requireString(objectItem["value"], "context.profile_memory.items[].value")
		if err != nil {
			return nil, err
		}
		sourceType, err := parseOptionalString(objectItem["source_type"])
		if err != nil {
			return nil, fmt.Errorf("context.profile_memory.items[].source_type must be a string")
		}
		confidence, err := parseOptionalString(objectItem["confidence"])
		if err != nil {
			return nil, fmt.Errorf("context.profile_memory.items[].confidence must be a string")
		}
		visibility, err := parseOptionalString(objectItem["visibility"])
		if err != nil {
			return nil, fmt.Errorf("context.profile_memory.items[].visibility must be a string")
		}
		lastVerifiedAt, err := parseOptionalString(objectItem["last_verified_at"])
		if err != nil {
			return nil, fmt.Errorf("context.profile_memory.items[].last_verified_at must be a string")
		}
		if sourceType == "" {
			sourceType = "user_declared"
		}
		if confidence == "" {
			confidence = "low"
		}
		if visibility == "" {
			visibility = "user_visible"
		}
		items = append(items, profileMemoryItem{
			ItemID:         itemID,
			Key:            key,
			Value:          value,
			SourceType:     sourceType,
			Confidence:     confidence,
			Visibility:     visibility,
			LastVerifiedAt: lastVerifiedAt,
		})
	}

	return items, nil
}

func parseSessionSummary(raw json.RawMessage) ([]sessionSlot, selectedNoticeRef, int, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, selectedNoticeRef{}, 0, nil
	}
	rawSession, err := parseObject(raw, "context.session")
	if err != nil {
		return nil, selectedNoticeRef{}, 0, fmt.Errorf("context.session must be an object")
	}

	var rawSlots []json.RawMessage
	if len(rawSession["confirmed_slots"]) > 0 {
		rawSlots, err = parseArray(rawSession["confirmed_slots"], "context.session.confirmed_slots")
		if err != nil {
			return nil, selectedNoticeRef{}, 0, err
		}
	}
	confirmedSlots := make([]sessionSlot, 0, len(rawSlots))
	for _, rawSlot := range rawSlots {
		objectSlot, err := parseObject(rawSlot, "context.session.confirmed_slots[]")
		if err != nil {
			return nil, selectedNoticeRef{}, 0, fmt.Errorf("context.session.confirmed_slots must only contain objects")
		}
		name, err := requireString(objectSlot["name"], "context.session.confirmed_slots[].name")
		if err != nil {
			return nil, selectedNoticeRef{}, 0, err
		}
		value, err := requireString(objectSlot["value"], "context.session.confirmed_slots[].value")
		if err != nil {
			return nil, selectedNoticeRef{}, 0, err
		}
		confirmed, err := parseOptionalBool(objectSlot["confirmed"], true)
		if err != nil {
			return nil, selectedNoticeRef{}, 0, fmt.Errorf("context.session.confirmed_slots[].confirmed must be a boolean")
		}
		confirmedSlots = append(confirmedSlots, sessionSlot{
			Name:      name,
			Value:     value,
			Confirmed: confirmed,
		})
	}

	selectedRef, err := parseSelectedNoticeRef(rawSession["selected_notice_ref"])
	if err != nil {
		return nil, selectedNoticeRef{}, 0, err
	}
	turnCount, err := parseOptionalInt(rawSession["turn_count"], 0)
	if err != nil {
		return nil, selectedNoticeRef{}, 0, fmt.Errorf("context.session.turn_count must be an integer")
	}
	return confirmedSlots, selectedRef, turnCount, nil
}

func parseSelectedNoticeRef(raw json.RawMessage) (selectedNoticeRef, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return selectedNoticeRef{}, nil
	}
	rawRef, err := parseObject(raw, "context.session.selected_notice_ref")
	if err != nil {
		return selectedNoticeRef{}, fmt.Errorf("context.session.selected_notice_ref must be an object")
	}
	noticeID, err := requireString(
		rawRef["notice_id"],
		"context.session.selected_notice_ref.notice_id",
	)
	if err != nil {
		return selectedNoticeRef{}, err
	}
	sourceFamily, err := parseOptionalString(rawRef["source_family"])
	if err != nil {
		return selectedNoticeRef{}, fmt.Errorf("context.session.selected_notice_ref.source_family must be a string")
	}
	title, err := parseOptionalString(rawRef["title"])
	if err != nil {
		return selectedNoticeRef{}, fmt.Errorf("context.session.selected_notice_ref.title must be a string")
	}
	return selectedNoticeRef{
		NoticeID:     noticeID,
		SourceFamily: sourceFamily,
		Title:        title,
	}, nil
}

func parseRequestedScope(raw json.RawMessage) (knowledgeScope, bool, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return knowledgeScope{}, false, nil
	}
	rawScope, err := parseObject(raw, "requested_scope")
	if err != nil {
		return knowledgeScope{}, false, fmt.Errorf("requested_scope must be an object")
	}
	corpus, err := parseOptionalString(rawScope["corpus"])
	if err != nil {
		return knowledgeScope{}, false, fmt.Errorf("requested_scope requires corpus and collection")
	}
	collection, err := parseOptionalString(rawScope["collection"])
	if err != nil {
		return knowledgeScope{}, false, fmt.Errorf("requested_scope requires corpus and collection")
	}
	if corpus == "" || collection == "" {
		return knowledgeScope{}, false, fmt.Errorf("requested_scope requires corpus and collection")
	}
	return knowledgeScope{Corpus: corpus, Collection: collection}, true, nil
}

func parseVersionQuery(raw json.RawMessage) (versionQuery, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return versionQuery{Mode: "current"}, nil
	}
	rawVersionQuery, err := parseObject(raw, "version_query")
	if err != nil {
		return versionQuery{}, fmt.Errorf("version_query must be an object")
	}
	mode, err := parseOptionalString(rawVersionQuery["mode"])
	if err != nil {
		return versionQuery{}, fmt.Errorf("version_query.mode must be a string")
	}
	asOf, err := parseOptionalString(rawVersionQuery["as_of"])
	if err != nil {
		return versionQuery{}, fmt.Errorf("version_query.as_of must be a string")
	}
	versionID, err := parseOptionalString(rawVersionQuery["version_id"])
	if err != nil {
		return versionQuery{}, fmt.Errorf("version_query.version_id must be a string")
	}
	compareToVersionID, err := parseOptionalString(rawVersionQuery["compare_to_version_id"])
	if err != nil {
		return versionQuery{}, fmt.Errorf("version_query.compare_to_version_id must be a string")
	}
	if mode == "" {
		mode = "current"
	}
	query := versionQuery{
		Mode:               mode,
		AsOf:               asOf,
		VersionID:          versionID,
		CompareToVersionID: compareToVersionID,
	}
	return query, validateVersionQuery(query)
}

func validateVersionQuery(query versionQuery) error {
	switch query.Mode {
	case "current", "historical", "as_of", "compare":
	default:
		return fmt.Errorf("unsupported version mode: %s", query.Mode)
	}
	if query.Mode == "as_of" {
		if query.AsOf == "" {
			return fmt.Errorf("as_of is required when version mode is as_of")
		}
		if query.VersionID != "" {
			return fmt.Errorf("version_id is not allowed when version mode is as_of")
		}
		if query.CompareToVersionID != "" {
			return fmt.Errorf("compare_to_version_id is only allowed when version mode is compare")
		}
	} else if query.AsOf != "" {
		return fmt.Errorf("as_of is only allowed when version mode is as_of")
	}
	if query.Mode != "historical" && query.Mode != "compare" && query.VersionID != "" {
		return fmt.Errorf("version_id is only allowed when version mode is historical or compare")
	}
	if query.Mode != "compare" && query.CompareToVersionID != "" {
		return fmt.Errorf("compare_to_version_id is only allowed when version mode is compare")
	}
	if query.CompareToVersionID != "" && query.VersionID == "" {
		return fmt.Errorf("version_id is required when compare_to_version_id is set")
	}
	return nil
}

func parseObject(raw json.RawMessage, fieldName string) (map[string]json.RawMessage, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("%s must be an object", fieldName)
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("%s must be an object", fieldName)
	}
	return payload, nil
}

func parseArray(raw json.RawMessage, fieldName string) ([]json.RawMessage, error) {
	var payload []json.RawMessage
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("%s must be an array", fieldName)
	}
	return payload, nil
}

func parseOptionalString(raw json.RawMessage) (string, error) {
	if len(raw) == 0 {
		return "", nil
	}
	if string(raw) == "null" {
		return "", nil
	}
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", err
	}
	return strings.TrimSpace(value), nil
}

func requireString(raw json.RawMessage, fieldName string) (string, error) {
	value, err := parseOptionalString(raw)
	if err != nil || value == "" {
		return "", fmt.Errorf("%s must be a non-empty string", fieldName)
	}
	return value, nil
}

func parseStringArray(raw json.RawMessage, fieldName string) ([]string, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, fmt.Errorf("%s must only contain strings", fieldName)
	}
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			normalized = append(normalized, trimmed)
		}
	}
	return normalized, nil
}

func parseOptionalBool(raw json.RawMessage, fallback bool) (bool, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return fallback, nil
	}
	var value bool
	if err := json.Unmarshal(raw, &value); err != nil {
		return false, err
	}
	return value, nil
}

func parseOptionalInt(raw json.RawMessage, fallback int) (int, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return fallback, nil
	}
	var value int
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, err
	}
	return value, nil
}

func assertSupportedFields(
	payload map[string]json.RawMessage,
	allowed []string,
	fieldPrefix string,
	messageFormat string,
) error {
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, field := range allowed {
		allowedSet[field] = struct{}{}
	}

	unsupported := make([]string, 0)
	for field := range payload {
		if _, ok := allowedSet[field]; !ok {
			unsupported = append(unsupported, fieldPrefix+"."+field)
		}
	}
	if len(unsupported) == 0 {
		return nil
	}
	sort.Strings(unsupported)
	return fmt.Errorf(messageFormat, strings.Join(unsupported, ", "))
}

func invalidRequest(message string) *HTTPError {
	return &HTTPError{
		Status:  400,
		Code:    "invalid_request",
		Message: message,
	}
}

func extractBearerToken(headerValue string) string {
	scheme, token, found := strings.Cut(strings.TrimSpace(headerValue), " ")
	if !found || !strings.EqualFold(scheme, "bearer") {
		return ""
	}
	return strings.TrimSpace(token)
}

func newDefaultContextProjection(actor actorContext) contextProjection {
	return contextProjection{
		Actor:         actor,
		Authorization: newDefaultAuthorizationProjection(actor),
	}
}

func newDefaultAuthorizationProjection(actor actorContext) authorizationProjection {
	principalID := strings.TrimSpace(actor.PrincipalID)
	if principalID == "" {
		principalID = strings.TrimSpace(actor.UserID)
	}
	return authorizationProjection{
		PrincipalID: principalID,
		RetrievalFilter: authorizedRetrievalFilter{
			VisibilityLevel:       "public",
			PolicyProjectionValue: defaultPolicyProjectionVersion,
		},
	}
}

func isLowerHex64(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, runeValue := range value {
		if (runeValue < '0' || runeValue > '9') && (runeValue < 'a' || runeValue > 'f') {
			return false
		}
	}
	return true
}

func newTraceID() string {
	buffer := make([]byte, 16)
	_, _ = rand.Read(buffer)
	buffer[6] = (buffer[6] & 0x0f) | 0x40
	buffer[8] = (buffer[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
		buffer[0],
		buffer[1],
		buffer[2],
		buffer[3],
		buffer[4],
		buffer[5],
		buffer[6],
		buffer[7],
		buffer[8],
		buffer[9],
		buffer[10],
		buffer[11],
		buffer[12],
		buffer[13],
		buffer[14],
		buffer[15],
	)
}

func (a actorContext) isZero() bool {
	return a.UserID == "" &&
		a.PrincipalID == "" &&
		a.PrincipalType == "" &&
		len(a.Roles) == 0 &&
		len(a.Departments) == 0 &&
		a.Cohort == "" &&
		a.Major == "" &&
		a.Program == ""
}

func (a actorContext) equal(other actorContext) bool {
	return a.UserID == other.UserID &&
		a.PrincipalID == other.PrincipalID &&
		a.PrincipalType == other.PrincipalType &&
		slices.Equal(a.Roles, other.Roles) &&
		slices.Equal(a.Departments, other.Departments) &&
		a.Cohort == other.Cohort &&
		a.Major == other.Major &&
		a.Program == other.Program
}

func (a actorContext) toMap() map[string]any {
	result := map[string]any{}
	if a.UserID != "" {
		result["user_id"] = a.UserID
	}
	if a.PrincipalID != "" {
		result["principal_id"] = a.PrincipalID
	}
	if a.PrincipalType != "" {
		result["principal_type"] = a.PrincipalType
	}
	if len(a.Roles) > 0 {
		result["roles"] = a.Roles
	}
	if len(a.Departments) > 0 {
		result["departments"] = a.Departments
	}
	if a.Cohort != "" {
		result["cohort"] = a.Cohort
	}
	if a.Major != "" {
		result["major"] = a.Major
	}
	if a.Program != "" {
		result["program"] = a.Program
	}
	return result
}

func (a authorizationProjection) isZero() bool {
	return a.PrincipalID == "" &&
		a.ProjectionSource == "" &&
		a.EntitlementSnapshotID == "" &&
		len(a.EntitlementGroups) == 0 &&
		a.VisibilityScope == "" &&
		a.ApplicaibilityScope == "" &&
		len(a.OwnershipScopes) == 0 &&
		a.ApprovalState == "" &&
		len(a.RetrievalFilter.EntitlementGroups) == 0 &&
		a.RetrievalFilter.VisibilityLevel == "" &&
		a.RetrievalFilter.VisibilityScope == "" &&
		a.RetrievalFilter.PolicyProjectionValue == ""
}

func (a authorizationProjection) toMap() map[string]any {
	result := map[string]any{
		"principal_id": a.PrincipalID,
		"retrieval_filter": map[string]any{
			"visibility_level": defaultIfEmpty(a.RetrievalFilter.VisibilityLevel, "public"),
			"policy_projection_version": defaultIfEmpty(
				a.RetrievalFilter.PolicyProjectionValue,
				defaultPolicyProjectionVersion,
			),
		},
	}
	if a.ProjectionSource != "" {
		result["projection_source"] = a.ProjectionSource
	}
	if a.EntitlementSnapshotID != "" {
		result["entitlement_snapshot_id"] = a.EntitlementSnapshotID
	}
	if len(a.EntitlementGroups) > 0 {
		result["entitlement_groups"] = a.EntitlementGroups
	}
	if a.VisibilityScope != "" {
		result["visibility_scope"] = a.VisibilityScope
	}
	if a.ApplicaibilityScope != "" {
		result["applicability_scope"] = a.ApplicaibilityScope
	}
	if len(a.OwnershipScopes) > 0 {
		result["ownership_scopes"] = a.OwnershipScopes
	}
	if a.ApprovalState != "" {
		result["approval_state"] = a.ApprovalState
	}
	retrievalFilter := result["retrieval_filter"].(map[string]any)
	if len(a.RetrievalFilter.EntitlementGroups) > 0 {
		retrievalFilter["entitlement_groups"] = a.RetrievalFilter.EntitlementGroups
	}
	if a.RetrievalFilter.VisibilityScope != "" {
		retrievalFilter["visibility_scope"] = a.RetrievalFilter.VisibilityScope
	}
	return result
}

func (c contextProjection) toMap() map[string]any {
	session := map[string]any{
		"confirmed_slots": sessionSlotsToMaps(c.SessionSlots),
		"turn_count":      c.TurnCount,
	}
	if c.SelectedNoticeRef.NoticeID != "" {
		session["selected_notice_ref"] = c.SelectedNoticeRef.toMap()
	}
	result := map[string]any{
		"actor":         c.Actor.toMap(),
		"authorization": c.Authorization.toMap(),
		"profile_memory": map[string]any{
			"items": profileMemoryItemsToMaps(c.ProfileMemory),
		},
		"session": session,
	}
	return result
}

func (c contextProjection) noticeAccessContextMap() map[string]any {
	authorization := c.Authorization
	retrievalFilter := authorization.RetrievalFilter
	return map[string]any{
		"authorization": map[string]any{
			"principal_id":       authorization.PrincipalID,
			"entitlement_groups": append([]string(nil), authorization.EntitlementGroups...),
			"retrieval_filter": map[string]any{
				"entitlement_groups": append([]string(nil), retrievalFilter.EntitlementGroups...),
				"visibility_level": defaultIfEmpty(
					retrievalFilter.VisibilityLevel,
					"public",
				),
			},
		},
	}
}

func (r selectedNoticeRef) toMap() map[string]any {
	result := map[string]any{
		"notice_id": r.NoticeID,
	}
	if r.SourceFamily != "" {
		result["source_family"] = r.SourceFamily
	}
	if r.Title != "" {
		result["title"] = r.Title
	}
	return result
}

func profileMemoryItemsToMaps(items []profileMemoryItem) []map[string]any {
	results := make([]map[string]any, 0, len(items))
	for _, item := range items {
		result := map[string]any{
			"item_id":     item.ItemID,
			"key":         item.Key,
			"value":       item.Value,
			"source_type": defaultIfEmpty(item.SourceType, "user_declared"),
			"confidence":  defaultIfEmpty(item.Confidence, "low"),
			"visibility":  defaultIfEmpty(item.Visibility, "user_visible"),
		}
		if item.LastVerifiedAt != "" {
			result["last_verified_at"] = item.LastVerifiedAt
		}
		results = append(results, result)
	}
	return results
}

func sessionSlotsToMaps(slots []sessionSlot) []map[string]any {
	results := make([]map[string]any, 0, len(slots))
	for _, slot := range slots {
		results = append(results, map[string]any{
			"name":      slot.Name,
			"value":     slot.Value,
			"confirmed": slot.Confirmed,
		})
	}
	return results
}

func defaultIfEmpty(value string, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
