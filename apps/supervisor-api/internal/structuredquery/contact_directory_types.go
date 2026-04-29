package structuredquery

const contactDirectoryCandidateLimit = 10

type contactDirectoryResult struct {
	QueryText           string                         `json:"query_text"`
	ContactFocus        string                         `json:"contact_focus"`
	Outcome             string                         `json:"outcome"`
	ResolvedContact     *contactDirectoryContactRef    `json:"resolved_contact,omitempty"`
	ContactPoints       []contactDirectoryContactPoint `json:"contact_points,omitempty"`
	LocationRefs        []contactDirectoryLocationRef  `json:"location_refs,omitempty"`
	OfficeHours         []contactDirectoryOfficeHours  `json:"office_hours,omitempty"`
	CandidateContacts   []contactDirectoryCandidate    `json:"candidate_contacts,omitempty"`
	SourceRefs          []string                       `json:"source_refs,omitempty"`
	QueriedTimeAnchor   string                         `json:"queried_time_anchor,omitempty"`
	EffectiveFrom       string                         `json:"effective_from,omitempty"`
	EffectiveUntil      string                         `json:"effective_until,omitempty"`
	ClarificationReason string                         `json:"clarification_reason,omitempty"`
	FailCloseReason     string                         `json:"fail_close_reason,omitempty"`
}

type contactDirectoryContactRef struct {
	ContactID    string   `json:"contact_id"`
	DisplayName  string   `json:"display_name"`
	Aliases      []string `json:"aliases"`
	EntityType   string   `json:"entity_type"`
	Department   string   `json:"department"`
	ContactGroup string   `json:"contact_group"`
	CampusScope  string   `json:"campus_scope"`
	Audience     []string `json:"audience"`
}

type contactDirectoryContactPoint struct {
	ChannelType       string   `json:"channel_type"`
	Label             string   `json:"label"`
	Value             string   `json:"value"`
	NormalizedValue   string   `json:"normalized_value"`
	ContactType       string   `json:"contact_type"`
	AreaServed        string   `json:"area_served"`
	AvailableLanguage string   `json:"available_language"`
	HoursRef          string   `json:"hours_ref"`
	SourceRefs        []string `json:"source_refs"`
}

type contactDirectoryLocationRef struct {
	Label       string   `json:"label"`
	LocationRef string   `json:"location_ref"`
	AddressText string   `json:"address_text"`
	SourceRefs  []string `json:"source_refs"`
}

type contactDirectoryOfficeHours struct {
	HoursID       string   `json:"hours_id"`
	Label         string   `json:"label"`
	DayPattern    string   `json:"day_pattern"`
	TimeRange     string   `json:"time_range"`
	EffectiveNote string   `json:"effective_note"`
	SourceRefs    []string `json:"source_refs"`
}

type contactDirectoryCandidate struct {
	Contact           contactDirectoryContactRef `json:"contact"`
	ClarificationHint string                     `json:"clarification_hint,omitempty"`
}

type contactDirectoryEntitySelector struct {
	ContactID         string `json:"contact_id"`
	DepartmentQuery   string `json:"department_query"`
	OfficeQuery       string `json:"office_query"`
	ServiceQuery      string `json:"service_query"`
	PersonQuery       string `json:"person_query"`
	RoleQuery         string `json:"role_query"`
	PurposeQuery      string `json:"purpose_query"`
	ContactGroupQuery string `json:"contact_group_query"`
	LocationQuery     string `json:"location_query"`
}

type contactDirectoryRecord struct {
	ContactID        string                              `json:"contact_id"`
	DisplayName      string                              `json:"display_name"`
	Aliases          []string                            `json:"aliases"`
	ContactGroup     string                              `json:"contact_group"`
	Department       string                              `json:"department"`
	EntityType       string                              `json:"entity_type"`
	CampusScope      string                              `json:"campus_scope"`
	Audience         []string                            `json:"audience"`
	ContactPoints    []contactDirectoryContactPointEntry `json:"contact_points"`
	Phones           []contactDirectoryPhoneRecord       `json:"phones"`
	Emails           []contactDirectoryEmailRecord       `json:"emails"`
	LocationRefs     []any                               `json:"location_refs"`
	OfficeHours      []any                               `json:"office_hours"`
	SourceRefs       []string                            `json:"source_refs"`
	ExtractionStatus string                              `json:"extraction_status"`
}

type contactDirectoryPhoneRecord struct {
	PhoneID    string   `json:"phone_id"`
	Label      string   `json:"label"`
	Number     string   `json:"number"`
	SourceRefs []string `json:"source_refs"`
}

type contactDirectoryEmailRecord struct {
	EmailID    string   `json:"email_id"`
	Label      string   `json:"label"`
	Address    string   `json:"address"`
	SourceRefs []string `json:"source_refs"`
}

type contactDirectoryLocationEntry struct {
	Label       string   `json:"label"`
	LocationRef string   `json:"location_ref"`
	AddressText string   `json:"address_text"`
	SourceRefs  []string `json:"source_refs"`
}

type contactDirectoryOfficeHoursEntry struct {
	HoursID       string   `json:"hours_id"`
	Label         string   `json:"label"`
	DayPattern    string   `json:"day_pattern"`
	TimeRange     string   `json:"time_range"`
	EffectiveNote string   `json:"effective_note"`
	SourceRefs    []string `json:"source_refs"`
}

type contactDirectoryContactPointEntry struct {
	ChannelType       string   `json:"channel_type"`
	Label             string   `json:"label"`
	Value             string   `json:"value"`
	NormalizedValue   string   `json:"normalized_value"`
	ContactType       string   `json:"contact_type"`
	AreaServed        string   `json:"area_served"`
	AvailableLanguage string   `json:"available_language"`
	HoursRef          string   `json:"hours_ref"`
	SourceRefs        []string `json:"source_refs"`
}

type contactDirectoryConflictRecord struct {
	ContactID  string   `json:"contact_id"`
	Reason     string   `json:"reason"`
	SourceRefs []string `json:"source_refs"`
}

type contactDirectoryManualReviewInfo struct {
	ContactID string `json:"contact_id"`
	SourceRef string `json:"source_ref"`
	Reason    string `json:"reason"`
	Line      string `json:"line"`
}

type contactDirectoryMatch struct {
	record contactDirectoryRecord
	score  int
}
