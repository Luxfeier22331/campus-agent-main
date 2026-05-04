package structuredquery

const serviceGuideCandidateLimit = 10

type serviceGuideRequest struct {
	ServiceQuery  string        `json:"service_query"`
	GuideFocus    string        `json:"guide_focus"`
	TemporalQuery temporalQuery `json:"temporal_query"`
	CampusScope   string        `json:"campus_scope"`
	Audience      string        `json:"audience"`
	ResultLimit   *int          `json:"result_limit"`
}

type serviceGuideResult struct {
	ServiceQuery           string                  `json:"service_query"`
	GuideFocus             string                  `json:"guide_focus"`
	Outcome                string                  `json:"outcome"`
	ResolvedService        *serviceGuideServiceRef `json:"resolved_service,omitempty"`
	GuideSections          []serviceGuideSection   `json:"guide_sections,omitempty"`
	ProcedureGroups        []serviceGuideProcedureGroup `json:"procedure_groups,omitempty"`
	RequiredMaterials      []serviceGuideMaterial  `json:"required_materials,omitempty"`
	EntryRefs              []serviceGuideEntryRef  `json:"entry_refs,omitempty"`
	OfficeHours            []serviceGuideHours     `json:"office_hours,omitempty"`
	ContactRefs            []serviceGuideContact   `json:"contact_refs,omitempty"`
	EligibilityNotes       []string                `json:"eligibility_notes,omitempty"`
	SourceRefs             []string                `json:"source_refs,omitempty"`
	CandidateServices      []serviceGuideCandidate `json:"candidate_services,omitempty"`
	QueriedTimeAnchor      string                  `json:"queried_time_anchor,omitempty"`
	EffectiveFrom          string                  `json:"effective_from,omitempty"`
	EffectiveUntil         string                  `json:"effective_until,omitempty"`
	ClarificationReason    string                  `json:"clarification_reason,omitempty"`
	FailCloseReason        string                  `json:"fail_close_reason,omitempty"`
	MatchedServiceCategory string                  `json:"matched_service_category,omitempty"`
	SelectedSectionIDs     []string                `json:"selected_section_ids,omitempty"`
	OmittedSectionIDs      []string                `json:"omitted_section_ids,omitempty"`
	OmittedSectionReasons  map[string]string       `json:"omitted_section_reasons,omitempty"`
	FieldStatus            map[string]string       `json:"field_status,omitempty"`
}

type serviceGuideServiceRef struct {
	ServiceID   string   `json:"service_id"`
	DisplayName string   `json:"display_name"`
	Aliases     []string `json:"aliases"`
	Category    string   `json:"category"`
	CampusScope string   `json:"campus_scope"`
	Audience    []string `json:"audience"`
}

type serviceGuideSection struct {
	SectionID   string   `json:"section_id"`
	SectionType string   `json:"section_type"`
	Title       string   `json:"title"`
	Content     string   `json:"content"`
	SourceRefs  []string `json:"source_refs"`
}

type serviceGuideProcedureStep struct {
	StepID     string   `json:"step_id"`
	Content    string   `json:"content"`
	SourceRefs []string `json:"source_refs"`
}

type serviceGuideProcedureGroup struct {
	GroupID   string                      `json:"group_id"`
	Title     string                      `json:"title"`
	FocusTags []string                    `json:"focus_tags"`
	Steps     []serviceGuideProcedureStep `json:"steps"`
	SourceRefs []string                   `json:"source_refs"`
}

type serviceGuideMaterial struct {
	Name       string   `json:"name"`
	Required   bool     `json:"required"`
	Note       string   `json:"note"`
	SourceRefs []string `json:"source_refs"`
}

type serviceGuideEntryRef struct {
	Label       string   `json:"label"`
	EntryType   string   `json:"entry_type"`
	URL         string   `json:"url,omitempty"`
	LocationRef string   `json:"location_ref,omitempty"`
	SourceRefs  []string `json:"source_refs"`
}

type serviceGuideHours struct {
	Label         string   `json:"label"`
	DayPattern    string   `json:"day_pattern"`
	TimeRange     string   `json:"time_range"`
	EffectiveNote string   `json:"effective_note"`
	SourceRefs    []string `json:"source_refs"`
}

type serviceGuideContact struct {
	Label       string   `json:"label"`
	Department  string   `json:"department"`
	Phone       string   `json:"phone,omitempty"`
	Email       string   `json:"email,omitempty"`
	LocationRef string   `json:"location_ref,omitempty"`
	SourceRefs  []string `json:"source_refs"`
}

type serviceGuideCandidate struct {
	Service           serviceGuideServiceRef `json:"service"`
	ClarificationHint string                 `json:"clarification_hint,omitempty"`
}

type serviceGuideRecord struct {
	ServiceID        string                       `json:"service_id"`
	DisplayName      string                       `json:"display_name"`
	Aliases          []string                     `json:"aliases"`
	Category         string                       `json:"category"`
	CampusScope      string                       `json:"campus_scope"`
	Audience         []string                     `json:"audience"`
	EffectiveFrom    string                       `json:"effective_from"`
	EffectiveUntil   string                       `json:"effective_until"`
	SourceRefs       []string                     `json:"source_refs"`
	GuideSections    []serviceGuideSectionRecord  `json:"guide_sections"`
	ProcedureGroups  []serviceGuideProcedureGroupRecord `json:"procedure_groups"`
	Materials        []serviceGuideMaterialRecord `json:"materials"`
	EntryRefs        []serviceGuideEntryRecord    `json:"entry_refs"`
	OfficeHours      []serviceGuideHoursRecord    `json:"office_hours"`
	ContactRefs      []serviceGuideContactRecord  `json:"contact_refs"`
	EligibilityNotes []string                     `json:"eligibility_notes"`
	ExtractionStatus string                       `json:"extraction_status"`
	FieldStatus      map[string]string            `json:"field_status"`
}

type serviceGuideSectionRecord struct {
	SectionID   string   `json:"section_id"`
	SectionType string   `json:"section_type"`
	Title       string   `json:"title"`
	Content     string   `json:"content"`
	Order       int      `json:"order"`
	SourceRefs  []string `json:"source_refs"`
}

type serviceGuideProcedureStepRecord struct {
	StepID     string   `json:"step_id"`
	Content    string   `json:"content"`
	Order      int      `json:"order"`
	SourceRefs []string `json:"source_refs"`
}

type serviceGuideProcedureGroupRecord struct {
	GroupID    string                            `json:"group_id"`
	Title      string                            `json:"title"`
	FocusTags  []string                          `json:"focus_tags"`
	Order      int                               `json:"order"`
	Steps      []serviceGuideProcedureStepRecord `json:"steps"`
	SourceRefs []string                          `json:"source_refs"`
}

type serviceGuideMaterialRecord struct {
	MaterialID string   `json:"material_id"`
	Name       string   `json:"name"`
	Required   bool     `json:"required"`
	Note       string   `json:"note"`
	SourceRefs []string `json:"source_refs"`
}

type serviceGuideEntryRecord struct {
	EntryID     string   `json:"entry_id"`
	Label       string   `json:"label"`
	EntryType   string   `json:"entry_type"`
	URL         string   `json:"url"`
	LocationRef string   `json:"location_ref"`
	SourceRefs  []string `json:"source_refs"`
}

type serviceGuideHoursRecord struct {
	HoursID       string   `json:"hours_id"`
	Label         string   `json:"label"`
	DayPattern    string   `json:"day_pattern"`
	TimeRange     string   `json:"time_range"`
	EffectiveNote string   `json:"effective_note"`
	SourceRefs    []string `json:"source_refs"`
}

type serviceGuideContactRecord struct {
	ContactID   string   `json:"contact_id"`
	Label       string   `json:"label"`
	Department  string   `json:"department"`
	Phone       string   `json:"phone"`
	Email       string   `json:"email"`
	LocationRef string   `json:"location_ref"`
	SourceRefs  []string `json:"source_refs"`
}

type serviceGuideConflictRecord struct {
	ServiceID string `json:"service_id"`
}

type serviceGuideManualReviewRecord struct {
	ServiceID string `json:"service_id"`
}

type serviceGuideMatch struct {
	record serviceGuideRecord
	score  int
}
