package structuredplanning

const CapabilityPlanSchemaVersion = "capability-plan-internal-v1"

type CapabilityPlan struct {
	SchemaVersion     string
	Capability        string
	UserGoalSummary   string
	RequiredArtifacts []string
	OptionalArtifacts []string
	Constraints       CapabilityConstraints
	AnswerPolicy      CapabilityAnswerPolicy
	GroundingPolicy   CapabilityGroundingPolicy
	Budget            CapabilityBudget
	FailClose         CapabilityFailClose
}

type CapabilityConstraints struct {
	RequestedScope *CapabilityScopeConstraint
	SelectedNotice *CapabilitySelectedNoticeConstraint
	TransportQuery *CapabilityTransportQueryConstraint
}

type CapabilityScopeConstraint struct {
	Corpus     string
	Collection string
}

type CapabilitySelectedNoticeConstraint struct {
	Required              bool
	NoticeID              string
	SourceFamily          string
	TargetSurface         string
	AllowedTargetSurfaces []string
}

type CapabilityTransportQueryConstraint struct {
	QueryText       string
	RouteLabels     []string
	DirectionLabels []string
	StopLabels      []string
	ServiceDate     string
	QueryTimeAnchor string
}

type CapabilityAnswerPolicy struct {
	FinalAnswerOwner             string
	RequiresArtifactBackedAnswer bool
}

type CapabilityGroundingPolicy struct {
	Required          bool
	RequiredArtifacts []string
}

type CapabilityBudget struct {
	MaxSteps   int
	MaxReplans int
}

type CapabilityFailClose struct {
	FailClosed bool
	Reason     string
}

func selectedNoticeKnowledgeFollowthroughCapabilityPlan(request Request) CapabilityPlan {
	return CapabilityPlan{
		SchemaVersion:   CapabilityPlanSchemaVersion,
		Capability:      request.EffectiveCapability,
		UserGoalSummary: request.UserGoal,
		RequiredArtifacts: []string{
			"notice_context",
			"evidence_bundle",
			"grounding_verdict",
		},
		OptionalArtifacts: []string{},
		Constraints: CapabilityConstraints{
			RequestedScope: &CapabilityScopeConstraint{
				Corpus:     request.RequestedScope.Corpus,
				Collection: request.RequestedScope.Collection,
			},
			SelectedNotice: &CapabilitySelectedNoticeConstraint{
				Required:      true,
				NoticeID:      request.SelectedNoticeRef.NoticeID,
				SourceFamily:  request.SelectedNoticeRef.SourceFamily,
				TargetSurface: request.SelectedNoticeRef.TargetSurface,
				AllowedTargetSurfaces: []string{
					"regulations/student_rules",
					"regulations/institutional_rules",
					"regulations/scoped_rules",
				},
			},
		},
		AnswerPolicy: CapabilityAnswerPolicy{
			FinalAnswerOwner:             "execution-control-finalizer",
			RequiresArtifactBackedAnswer: true,
		},
		GroundingPolicy: CapabilityGroundingPolicy{
			Required:          true,
			RequiredArtifacts: []string{"evidence_bundle", "grounding_verdict"},
		},
		Budget: CapabilityBudget{
			MaxSteps:   2,
			MaxReplans: 1,
		},
		FailClose: CapabilityFailClose{
			FailClosed: true,
			Reason:     "selected_notice_target_surface_ineligible_for_knowledge_followthrough",
		},
	}
}
