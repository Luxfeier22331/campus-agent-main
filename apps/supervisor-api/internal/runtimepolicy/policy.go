package runtimepolicy

import "strings"

const (
	PolicyVersion     = "runtime-policy-v1"
	ClassifierVersion = "go-runtime-policy-v1"
	IntentSchema      = "intent-schema-1.0.0"
)

const (
	curriculumProgramSlot       = "curriculum_program"
	curriculumProgramFamilySlot = "curriculum_program_family"
	curriculumSemesterSlot      = "curriculum_semester"
)

var delegatedActionPrefixSignals = []string{"帮我", "代我", "替我"}

var highRiskTransactionActionSignals = []string{
	"提交",
	"申请",
	"办理",
	"预约",
	"报名",
	"缴费",
	"支付",
	"发送",
	"上传",
	"删除",
	"取消",
	"修改",
	"确认",
	"代办",
}

var politicalTopicSignals = []string{
	"政治",
	"政策",
	"候选人",
	"选举",
	"投票",
	"政党",
	"政府",
	"国家主席",
	"总统",
	"意识形态",
}

var politicalInfluenceActionSignals = []string{"说服", "劝说", "拉票", "动员", "煽动", "影响", "宣传"}
var politicalTargetAudienceSignals = []string{"同学", "学生", "老师", "家长", "公众", "大家", "群里", "选民"}
var politicalPositionSignals = []string{"支持", "反对", "投票给", "不要投票给"}
var politicalMessageWritingSignals = []string{"写一段话", "写文案", "写帖子", "写宣传稿", "写一篇"}

var campusScopeSignals = []string{
	"中央民族大学",
	"民大",
	"培养方案",
	"人才培养",
	"培养计划",
	"课程",
	"学分",
	"学期",
	"大一",
	"大二",
	"大三",
	"大四",
	"学院",
	"专业",
	"民族实验班",
	"基地班",
	"创新班",
	"奖学金",
	"助学金",
	"选课",
	"开课",
	"教务",
	"校历",
	"图书馆",
	"宿舍",
	"学籍",
	"转专业",
	"毕业",
	"推免",
	"保研",
	"学生证",
	"处分",
	"申诉",
	"习概",
	"习近平新时代中国特色社会主义思想概论",
	"习近平法治思想概论",
	"马原",
	"毛概",
	"史纲",
	"形策",
	"民概",
	"图书",
	"春假",
	"library",
	"scholarship",
	"curriculum",
	"graduationrequirements",
	"course",
}

var externalInstitutionSignals = []string{
	"mit",
	"麻省理工",
	"harvard",
	"哈佛",
	"stanford",
	"斯坦福",
	"oxford",
	"牛津",
	"cambridge",
	"剑桥",
	"清华",
	"北京大学",
	"北大",
	"复旦",
	"上海交大",
	"浙大",
}

var generalWorldSignals = []string{
	"天气",
	"股价",
	"汇率",
	"比特币",
	"世界杯",
	"nba",
	"写诗",
	"写一首诗",
	"讲个笑话",
	"推荐电影",
	"推荐一部电影",
	"电影",
	"量子力学",
	"相对论",
	"黑洞",
	"宇宙",
}

var geopoliticalEntitySignals = []string{"中国", "美国", "英国", "法国", "德国", "日本", "俄罗斯", "欧盟", "联合国"}
var politicalOfficeSignals = []string{"国家主席", "主席是谁", "总统", "总理", "首相", "外交部长", "领导人是谁"}
var contextualFollowUpSignals = []string{"这个流程", "该流程", "流程怎么办"}
var structuredTransportSignals = []string{"校车", "班车", "通勤车", "接驳车"}
var structuredServiceSubjectSignals = []string{"图书馆", "食堂", "会议室", "校医院", "校园卡", "一卡通", "宿舍", "报修"}
var structuredServiceStatusSignals = []string{"开门", "开放", "营业", "办公时间", "开放时间", "开到几点", "营业到几点", "状态"}
var structuredNoticeSignals = []string{"通知", "公告", "公示"}
var noticeContextReferenceSignals = []string{
	"这条通知",
	"这则通知",
	"该通知",
	"这个通知",
	"这条公告",
	"上一条通知",
	"上一条公告",
	"刚才的通知",
	"前面的通知",
}
var curriculumSemesterSignals = []string{"大一上", "大一下", "大二上", "大二下", "大三上", "大三下", "大四上", "大四下"}
var followUpLeadingSignals = []string{"那", "这个", "该", "上一", "刚才", "前面"}

type Scope struct {
	Corpus     string
	Collection string
}

type SessionSlot struct {
	Name  string
	Value string
}

type SelectedNoticeRef struct {
	NoticeID     string
	SourceFamily string
	Title        string
}

type ProfileMemoryItem struct {
	Value string
}

type Context struct {
	SessionSlots      []SessionSlot
	SelectedNoticeRef SelectedNoticeRef
	ProfileMemory     []ProfileMemoryItem
}

type Request struct {
	EffectiveCapability string
	UserGoal            string
	HasRequestedScope   bool
	RequestedScope      Scope
	Context             Context
}

type Decision struct {
	ScopeGate        ScopeGate
	PolicyGate       PolicyGate
	ContextPreflight ContextPreflight
	ToolPolicy       ToolPolicy
	RoutingFrame     RoutingFrame
}

type ScopeGate struct {
	Decision      string
	Reason        string
	MatchedSignal string
}

func (g ScopeGate) Map() map[string]any {
	return map[string]any{
		"decision":       g.Decision,
		"reason":         g.Reason,
		"matched_signal": g.MatchedSignal,
	}
}

type PolicyGate struct {
	Decision      string
	Reason        string
	RiskLevel     string
	MatchedSignal string
}

func (g PolicyGate) Map() map[string]any {
	return map[string]any{
		"decision":       g.Decision,
		"reason":         g.Reason,
		"risk_level":     g.RiskLevel,
		"matched_signal": g.MatchedSignal,
	}
}

type ContextPreflight struct {
	State           string
	ReferenceType   string
	ResolvedSlots   map[string]string
	MissingSlots    []string
	AmbiguityReason string
	MatchedSignal   string
}

func (p ContextPreflight) Map() map[string]any {
	resolvedSlots := map[string]string{}
	for key, value := range p.ResolvedSlots {
		resolvedSlots[key] = value
	}
	return map[string]any{
		"state":            p.State,
		"reference_type":   p.ReferenceType,
		"resolved_slots":   resolvedSlots,
		"missing_slots":    append([]string(nil), p.MissingSlots...),
		"ambiguity_reason": p.AmbiguityReason,
		"matched_signal":   p.MatchedSignal,
	}
}

type ToolPolicy struct {
	PolicyVersion string
}

func (p ToolPolicy) Map() map[string]any {
	return map[string]any{
		"policy_version": p.PolicyVersion,
	}
}

type RoutingFrame struct {
	Capability             string
	TaskKind               string
	DomainCandidates       []string
	MissingSlots           []string
	RiskLevel              string
	NeedsClarification     bool
	SuggestedNextAction    string
	PersonalizationMode    string
	ClarificationSubject   string
	ScopeClass             string
	PolicyReason           string
	LaunchState            string
	ScopeReason            string
	MatchedSignal          string
	ClassifierVersion      string
	SchemaVersion          string
	RoutingConfidence      string
	AmbiguitySignal        string
	ContextResolutionState string
	ContextReferenceType   string
	ResolvedSlots          map[string]string
	AmbiguityReason        string
}

func (f RoutingFrame) Map() map[string]any {
	resolvedSlots := map[string]string{}
	for key, value := range f.ResolvedSlots {
		resolvedSlots[key] = value
	}
	return map[string]any{
		"capability":               f.Capability,
		"task_kind":                f.TaskKind,
		"domain_candidates":        append([]string(nil), f.DomainCandidates...),
		"missing_slots":            append([]string(nil), f.MissingSlots...),
		"risk_level":               f.RiskLevel,
		"needs_clarification":      f.NeedsClarification,
		"suggested_next_action":    f.SuggestedNextAction,
		"personalization_mode":     f.PersonalizationMode,
		"clarification_subject":    f.ClarificationSubject,
		"scope_class":              f.ScopeClass,
		"policy_reason":            f.PolicyReason,
		"launch_state":             f.LaunchState,
		"scope_reason":             f.ScopeReason,
		"matched_signal":           f.MatchedSignal,
		"classifier_version":       f.ClassifierVersion,
		"schema_version":           f.SchemaVersion,
		"routing_confidence":       f.RoutingConfidence,
		"ambiguity_signal":         f.AmbiguitySignal,
		"context_resolution_state": f.ContextResolutionState,
		"context_reference_type":   f.ContextReferenceType,
		"resolved_slots":           resolvedSlots,
		"ambiguity_reason":         f.AmbiguityReason,
	}
}

func Evaluate(request Request) Decision {
	normalizedGoal := NormalizeGoal(request.UserGoal)
	contextPreflight := resolveContextFollowUp(request.Context, normalizedGoal)
	scopeGate := evaluateScope(request, normalizedGoal)
	policyGate := PolicyGate{Decision: "delegate", RiskLevel: "low"}

	frame := baseRoutingFrame(request.EffectiveCapability)
	frame.ContextResolutionState = contextPreflight.State
	frame.ContextReferenceType = contextPreflight.ReferenceType
	frame.ResolvedSlots = contextPreflight.ResolvedSlots
	frame.AmbiguityReason = contextPreflight.AmbiguityReason

	if reason := evaluatePolicyReason(normalizedGoal); reason != "" {
		policyGate = PolicyGate{
			Decision:  "rejected",
			Reason:    reason,
			RiskLevel: "high",
		}
		frame.DomainCandidates = []string{"policy_refusal"}
		frame.RiskLevel = "high"
		frame.SuggestedNextAction = "rejected"
		frame.ScopeClass = "in_scope"
		frame.PolicyReason = reason
		frame.LaunchState = "closed"
		frame.ScopeReason = "policy_guardrail"
		return Decision{scopeGate, policyGate, contextPreflight, ToolPolicy{PolicyVersion}, frame}
	}

	if isHighRiskTransactionAction(normalizedGoal) {
		policyGate = PolicyGate{
			Decision:  "approval_required",
			Reason:    "approval_required",
			RiskLevel: "high",
		}
		frame.DomainCandidates = domainCandidatesForCapability(request.EffectiveCapability, request)
		frame.RiskLevel = "high"
		frame.SuggestedNextAction = "approval_required"
		frame.ScopeClass = "in_scope"
		frame.PolicyReason = "approval_required"
		frame.LaunchState = "closed"
		frame.ScopeReason = "transaction_guardrail"
		return Decision{scopeGate, policyGate, contextPreflight, ToolPolicy{PolicyVersion}, frame}
	}

	if contextPreflight.State == "missing_context" || contextPreflight.State == "ambiguous" {
		reason := "context_missing"
		if contextPreflight.State == "ambiguous" {
			reason = "context_ambiguous"
		}
		frame.DomainCandidates = []string{"context_follow_up"}
		frame.MissingSlots = append([]string(nil), contextPreflight.MissingSlots...)
		frame.NeedsClarification = true
		frame.SuggestedNextAction = "clarify"
		frame.ScopeClass = "in_scope"
		frame.LaunchState = "candidate_only"
		frame.ScopeReason = reason
		frame.MatchedSignal = contextPreflight.MatchedSignal
		frame.RoutingConfidence = "low"
		if contextPreflight.State == "ambiguous" {
			frame.AmbiguitySignal = contextPreflight.MatchedSignal
		}
		policyGate = PolicyGate{
			Decision:      "clarify",
			Reason:        reason,
			RiskLevel:     "low",
			MatchedSignal: contextPreflight.MatchedSignal,
		}
		return Decision{scopeGate, policyGate, contextPreflight, ToolPolicy{PolicyVersion}, frame}
	}

	switch request.EffectiveCapability {
	case "place_lookup":
		frame.DomainCandidates = []string{"out_of_scope"}
		frame.SuggestedNextAction = "out_of_scope"
		frame.ScopeClass = "out_of_scope"
		frame.PolicyReason = "navigation_temporarily_unsupported"
		frame.LaunchState = "closed"
		frame.ScopeReason = "navigation_temporarily_unsupported"
		policyGate = PolicyGate{Decision: "out_of_scope", Reason: frame.PolicyReason, RiskLevel: "low"}
	case "campus_services":
		frame.DomainCandidates = []string{"campus_services"}
		frame.ScopeClass = "in_scope"
		frame.ScopeReason = "explicit_requested_capability"
	case "notice":
		frame.DomainCandidates = []string{"notice"}
		frame.ScopeClass = "in_scope"
		frame.ScopeReason = "explicit_requested_capability"
	default:
		if scopeGate.Decision == "out_of_scope" {
			frame.DomainCandidates = []string{"out_of_scope"}
			frame.SuggestedNextAction = "out_of_scope"
			frame.ScopeClass = "out_of_scope"
			frame.PolicyReason = scopeGate.Reason
			frame.LaunchState = "closed"
			frame.ScopeReason = scopeGate.Reason
			frame.MatchedSignal = scopeGate.MatchedSignal
			policyGate = PolicyGate{
				Decision:      "out_of_scope",
				Reason:        scopeGate.Reason,
				RiskLevel:     "low",
				MatchedSignal: scopeGate.MatchedSignal,
			}
		} else {
			frame.DomainCandidates = knowledgeDomains(request)
			frame.ScopeClass = "in_scope"
			frame.ScopeReason = scopeGate.Reason
			frame.MatchedSignal = scopeGate.MatchedSignal
			if scopeGate.Reason == "structured_runtime_candidate_signal" {
				frame.LaunchState = "candidate_only"
			}
		}
	}

	return Decision{scopeGate, policyGate, contextPreflight, ToolPolicy{PolicyVersion}, frame}
}

func baseRoutingFrame(capability string) RoutingFrame {
	return RoutingFrame{
		Capability:             defaultString(capability, "knowledge"),
		TaskKind:               taskKindForCapability(capability),
		DomainCandidates:       []string{"knowledge"},
		MissingSlots:           []string{},
		RiskLevel:              "low",
		NeedsClarification:     false,
		SuggestedNextAction:    "delegate",
		PersonalizationMode:    "generic",
		ClarificationSubject:   "",
		ScopeClass:             "in_scope",
		PolicyReason:           "",
		LaunchState:            "open",
		ScopeReason:            "scope_undetermined_delegate",
		MatchedSignal:          "",
		ClassifierVersion:      ClassifierVersion,
		SchemaVersion:          IntentSchema,
		RoutingConfidence:      "high",
		AmbiguitySignal:        "",
		ContextResolutionState: "not_follow_up",
		ContextReferenceType:   "none",
		ResolvedSlots:          map[string]string{},
		AmbiguityReason:        "",
	}
}

func evaluateScope(request Request, normalizedGoal string) ScopeGate {
	if request.EffectiveCapability != "" && request.EffectiveCapability != "knowledge" {
		return ScopeGate{Decision: "in_scope", Reason: "explicit_requested_capability"}
	}
	if request.HasRequestedScope {
		return ScopeGate{Decision: "in_scope", Reason: "explicit_requested_scope"}
	}
	if normalizedGoal == "" {
		return ScopeGate{Decision: "in_scope", Reason: "scope_undetermined_delegate"}
	}
	if signal := firstMatch(normalizedGoal, externalInstitutionSignals); signal != "" {
		return ScopeGate{Decision: "out_of_scope", Reason: "product_scope_boundary", MatchedSignal: signal}
	}
	if signal := firstMatch(normalizedGoal, generalWorldSignals); signal != "" {
		return ScopeGate{Decision: "out_of_scope", Reason: "product_scope_boundary", MatchedSignal: signal}
	}
	if signal := matchOpenDomainPoliticalFact(normalizedGoal); signal != "" {
		return ScopeGate{Decision: "out_of_scope", Reason: "product_scope_boundary", MatchedSignal: signal}
	}
	if signal := matchStructuredRuntimeCandidate(normalizedGoal); signal != "" {
		return ScopeGate{Decision: "in_scope", Reason: "structured_runtime_candidate_signal", MatchedSignal: signal}
	}
	if signal := firstMatch(normalizedGoal, campusScopeSignals); signal != "" {
		return ScopeGate{Decision: "in_scope", Reason: "campus_scope_signal", MatchedSignal: signal}
	}
	if signal := firstMatch(normalizedGoal, contextualFollowUpSignals); signal != "" {
		if contextSignal := firstContextSignal(request.Context); contextSignal != "" {
			return ScopeGate{Decision: "in_scope", Reason: "campus_context_signal", MatchedSignal: contextSignal}
		}
		return ScopeGate{Decision: "out_of_scope", Reason: "product_scope_boundary", MatchedSignal: signal}
	}
	return ScopeGate{Decision: "out_of_scope", Reason: "product_scope_boundary"}
}

func resolveContextFollowUp(context Context, normalizedGoal string) ContextPreflight {
	if signal := firstMatch(normalizedGoal, noticeContextReferenceSignals); signal != "" {
		if context.SelectedNoticeRef.NoticeID == "" {
			return ContextPreflight{
				State:         "missing_context",
				ReferenceType: "selected_notice",
				MissingSlots:  []string{"selected_notice_ref"},
				ResolvedSlots: map[string]string{},
				MatchedSignal: signal,
			}
		}
		resolvedSlots := map[string]string{"notice_id": context.SelectedNoticeRef.NoticeID}
		if context.SelectedNoticeRef.SourceFamily != "" {
			resolvedSlots["notice_source_family"] = context.SelectedNoticeRef.SourceFamily
		}
		if context.SelectedNoticeRef.Title != "" {
			resolvedSlots["notice_title"] = context.SelectedNoticeRef.Title
		}
		return ContextPreflight{
			State:         "resolved",
			ReferenceType: "selected_notice",
			ResolvedSlots: resolvedSlots,
			MissingSlots:  []string{},
			MatchedSignal: signal,
		}
	}

	if signal := firstMatch(normalizedGoal, curriculumSemesterSignals); signal != "" &&
		looksLikeContextualSemesterFollowUp(normalizedGoal) {
		program := sessionSlotValue(context.SessionSlots, curriculumProgramSlot)
		programFamily := sessionSlotValue(context.SessionSlots, curriculumProgramFamilySlot)
		if program == "" && programFamily == "" {
			return ContextPreflight{
				State:         "missing_context",
				ReferenceType: "curriculum_slot",
				MissingSlots:  []string{curriculumProgramSlot},
				ResolvedSlots: map[string]string{},
				MatchedSignal: signal,
			}
		}
		resolvedSlots := map[string]string{curriculumSemesterSlot: signal}
		if program != "" {
			resolvedSlots[curriculumProgramSlot] = program
		}
		if programFamily != "" {
			resolvedSlots[curriculumProgramFamilySlot] = programFamily
		}
		return ContextPreflight{
			State:         "resolved",
			ReferenceType: "curriculum_slot",
			ResolvedSlots: resolvedSlots,
			MissingSlots:  []string{},
			MatchedSignal: signal,
		}
	}

	return ContextPreflight{
		State:         "not_follow_up",
		ReferenceType: "none",
		ResolvedSlots: map[string]string{},
		MissingSlots:  []string{},
	}
}

func evaluatePolicyReason(normalizedGoal string) string {
	if isTargetedPoliticalPersuasion(normalizedGoal) {
		return "political_persuasion"
	}
	return ""
}

func isHighRiskTransactionAction(normalizedGoal string) bool {
	for _, prefix := range delegatedActionPrefixSignals {
		if !strings.Contains(normalizedGoal, NormalizeGoal(prefix)) {
			continue
		}
		if containsAny(normalizedGoal, highRiskTransactionActionSignals) {
			return true
		}
	}
	return false
}

func isTargetedPoliticalPersuasion(normalizedGoal string) bool {
	if !containsAny(normalizedGoal, politicalTopicSignals) {
		return false
	}
	hasInfluence := containsAny(normalizedGoal, politicalInfluenceActionSignals)
	hasAudience := containsAny(normalizedGoal, politicalTargetAudienceSignals)
	hasPosition := containsAny(normalizedGoal, politicalPositionSignals)
	hasWriting := containsAny(normalizedGoal, politicalMessageWritingSignals)
	if hasInfluence && (hasAudience || hasPosition) {
		return true
	}
	return hasWriting && hasInfluence
}

func matchStructuredRuntimeCandidate(normalizedGoal string) string {
	if signal := firstMatch(normalizedGoal, structuredTransportSignals); signal != "" {
		return signal
	}
	if signal := firstMatch(normalizedGoal, structuredNoticeSignals); signal != "" {
		return signal
	}
	serviceSubject := firstMatch(normalizedGoal, structuredServiceSubjectSignals)
	if serviceSubject == "" {
		return ""
	}
	if !containsAny(normalizedGoal, structuredServiceStatusSignals) {
		return ""
	}
	return serviceSubject
}

func matchOpenDomainPoliticalFact(normalizedGoal string) string {
	if !containsAny(normalizedGoal, geopoliticalEntitySignals) {
		return ""
	}
	return firstMatch(normalizedGoal, politicalOfficeSignals)
}

func firstContextSignal(context Context) string {
	for _, slot := range context.SessionSlots {
		if signal := firstMatch(NormalizeGoal(slot.Value), campusScopeSignals); signal != "" {
			return signal
		}
	}
	for _, item := range context.ProfileMemory {
		if signal := firstMatch(NormalizeGoal(item.Value), campusScopeSignals); signal != "" {
			return signal
		}
	}
	return ""
}

func looksLikeContextualSemesterFollowUp(normalizedGoal string) bool {
	if strings.HasSuffix(normalizedGoal, "呢") || len([]rune(normalizedGoal)) <= 6 {
		return true
	}
	return containsAny(normalizedGoal, followUpLeadingSignals)
}

func sessionSlotValue(slots []SessionSlot, name string) string {
	for _, slot := range slots {
		if slot.Name == name {
			return slot.Value
		}
	}
	return ""
}

func knowledgeDomains(request Request) []string {
	if request.HasRequestedScope {
		return []string{request.RequestedScope.Corpus + "/" + request.RequestedScope.Collection}
	}
	return []string{"knowledge"}
}

func domainCandidatesForCapability(capability string, request Request) []string {
	switch capability {
	case "place_lookup":
		return []string{"navigation"}
	case "campus_services":
		return []string{"campus_services"}
	case "notice":
		return []string{"notice"}
	default:
		return knowledgeDomains(request)
	}
}

func taskKindForCapability(capability string) string {
	switch capability {
	case "place_lookup":
		return "place_lookup"
	case "campus_services":
		return "campus_services_lookup"
	case "notice":
		return "notice_lookup"
	default:
		return "knowledge_lookup"
	}
}

func NormalizeGoal(userGoal string) string {
	return strings.ToLower(strings.Join(strings.Fields(userGoal), ""))
}

func firstMatch(normalizedValue string, signals []string) string {
	for _, signal := range signals {
		normalizedSignal := NormalizeGoal(signal)
		if normalizedSignal != "" && strings.Contains(normalizedValue, normalizedSignal) {
			return signal
		}
	}
	return ""
}

func containsAny(normalizedValue string, signals []string) bool {
	return firstMatch(normalizedValue, signals) != ""
}

func defaultString(value string, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
