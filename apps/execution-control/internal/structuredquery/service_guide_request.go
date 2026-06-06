package structuredquery

import (
	"errors"
	"fmt"
	"strings"
)

func normalizeServiceGuideRequest(request *serviceGuideRequest) {
	request.ServiceQuery = strings.TrimSpace(request.ServiceQuery)
	request.GuideFocus = strings.TrimSpace(request.GuideFocus)
	request.TemporalQuery.Mode = strings.TrimSpace(request.TemporalQuery.Mode)
	if request.TemporalQuery.Mode == "" {
		request.TemporalQuery.Mode = "current"
	}
	request.TemporalQuery.AsOf = strings.TrimSpace(request.TemporalQuery.AsOf)
	request.TemporalQuery.YearHint = strings.TrimSpace(request.TemporalQuery.YearHint)
	request.CampusScope = strings.TrimSpace(request.CampusScope)
	request.Audience = strings.TrimSpace(request.Audience)
	if request.Audience == "" {
		request.Audience = "unknown"
	}
}

func isAllowedServiceGuideFocus(value string) bool {
	switch value {
	case "overview", "procedure", "required_materials", "entry", "office_hours", "contact", "eligibility", "full_guide":
		return true
	default:
		return false
	}
}

func validateServiceGuideRequest(request serviceGuideRequest) error {
	switch request.TemporalQuery.Mode {
	case "current", "latest", "effective", "as_of", "current_year":
	default:
		return fmt.Errorf("unsupported temporal_query.mode: %s", request.TemporalQuery.Mode)
	}
	if request.TemporalQuery.Mode == "as_of" && request.TemporalQuery.AsOf == "" {
		return errors.New("temporal_query.as_of is required when mode is as_of")
	}
	if request.TemporalQuery.Mode != "as_of" && request.TemporalQuery.AsOf != "" {
		return errors.New("temporal_query.as_of is only allowed when mode is as_of")
	}
	if request.TemporalQuery.Mode == "current_year" && request.TemporalQuery.YearHint == "" {
		return errors.New("temporal_query.year_hint is required when mode is current_year")
	}
	if request.TemporalQuery.Mode != "current_year" && request.TemporalQuery.YearHint != "" {
		return errors.New("temporal_query.year_hint is only allowed when mode is current_year")
	}
	if request.ResultLimit != nil && *request.ResultLimit <= 0 {
		return errors.New("result_limit must be positive")
	}
	return nil
}
