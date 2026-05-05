package structuredquery

type academicCalendarRecord struct {
	AcademicYearLabel string   `json:"academic_year_label"`
	TermLabel         string   `json:"term_label"`
	StartDate         string   `json:"start_date"`
	EndDate           string   `json:"end_date"`
	WeekIndex         int      `json:"week_index"`
	DayKind           string   `json:"day_kind"`
	ClassDayPattern   string   `json:"class_day_pattern"`
	IsMakeupClass     bool     `json:"is_makeup_class"`
	HolidayName       string   `json:"holiday_name"`
	SourceRefs        []string `json:"source_refs"`
}
