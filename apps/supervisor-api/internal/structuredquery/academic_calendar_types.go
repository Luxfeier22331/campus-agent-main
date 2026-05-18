package structuredquery

type academicCalendarRecord struct {
	CalendarRecordID      string            `json:"calendar_record_id"`
	RecordFamily          string            `json:"record_family"`
	SourceFamily          string            `json:"source_family"`
	SourcePrecedence      int               `json:"source_precedence"`
	SourceNoticeIDs       []string          `json:"source_notice_ids"`
	PrecedenceReason      string            `json:"precedence_reason"`
	ConflictRefs          []string          `json:"conflict_refs"`
	AcademicYearLabel     string            `json:"academic_year_label"`
	TermLabel             string            `json:"term_label"`
	StartDate             string            `json:"start_date"`
	EndDate               string            `json:"end_date"`
	WeekIndex             int               `json:"week_index"`
	DayKind               string            `json:"day_kind"`
	ClassDayPattern       string            `json:"class_day_pattern"`
	IsMakeupClass         bool              `json:"is_makeup_class"`
	HolidayName           string            `json:"holiday_name"`
	SourceRefs            []string          `json:"source_refs"`
	EventName             string            `json:"event_name"`
	EventType             string            `json:"event_type"`
	EventAliases          []string          `json:"event_aliases"`
	EventAliasTypes       map[string]string `json:"event_alias_types"`
	EventStartDate        string            `json:"event_start_date"`
	EventEndDateExclusive string            `json:"event_end_date_exclusive"`
	DisplayStartDate      string            `json:"display_start_date"`
	DisplayEndDate        string            `json:"display_end_date"`
	AppliesTo             []string          `json:"applies_to"`
	SourceTitle           string            `json:"source_title"`
	SourceURL             string            `json:"source_url"`
}
