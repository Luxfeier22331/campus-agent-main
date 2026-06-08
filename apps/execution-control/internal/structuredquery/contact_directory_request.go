package structuredquery

import (
	"errors"
	"fmt"
	"strings"
)

type contactDirectoryRequest struct {
	QueryText      string                          `json:"query_text"`
	ContactFocus   string                          `json:"contact_focus"`
	EntitySelector *contactDirectoryEntitySelector `json:"entity_selector"`
	TemporalQuery  temporalQuery                   `json:"temporal_query"`
	CampusScope    string                          `json:"campus_scope"`
	Audience       string                          `json:"audience"`
	ResultLimit    *int                            `json:"result_limit"`
}

func normalizeContactDirectoryRequest(request *contactDirectoryRequest) {
	request.QueryText = strings.TrimSpace(request.QueryText)
	request.ContactFocus = strings.TrimSpace(request.ContactFocus)
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
	if request.EntitySelector != nil {
		request.EntitySelector.ContactID = strings.TrimSpace(request.EntitySelector.ContactID)
		request.EntitySelector.DepartmentQuery = strings.TrimSpace(request.EntitySelector.DepartmentQuery)
		request.EntitySelector.OfficeQuery = strings.TrimSpace(request.EntitySelector.OfficeQuery)
		request.EntitySelector.ServiceQuery = strings.TrimSpace(request.EntitySelector.ServiceQuery)
		request.EntitySelector.PersonQuery = strings.TrimSpace(request.EntitySelector.PersonQuery)
		request.EntitySelector.RoleQuery = strings.TrimSpace(request.EntitySelector.RoleQuery)
		request.EntitySelector.PurposeQuery = strings.TrimSpace(request.EntitySelector.PurposeQuery)
		request.EntitySelector.ContactGroupQuery = strings.TrimSpace(
			request.EntitySelector.ContactGroupQuery,
		)
		request.EntitySelector.LocationQuery = strings.TrimSpace(request.EntitySelector.LocationQuery)
	}
}

func validateContactDirectoryRequest(request contactDirectoryRequest) error {
	if !isAllowedContactDirectoryFocus(request.ContactFocus) {
		return fmt.Errorf("unsupported contact_focus: %s", request.ContactFocus)
	}
	switch request.TemporalQuery.Mode {
	case "current", "latest", "effective":
	default:
		return fmt.Errorf("unsupported temporal_query.mode: %s", request.TemporalQuery.Mode)
	}
	if request.TemporalQuery.AsOf != "" {
		return errors.New("temporal_query.as_of is not supported for contact_directory_lookup")
	}
	if request.TemporalQuery.YearHint != "" {
		return errors.New("temporal_query.year_hint is not supported for contact_directory_lookup")
	}
	if request.ResultLimit != nil && *request.ResultLimit <= 0 {
		return errors.New("result_limit must be positive")
	}
	switch request.Audience {
	case "student", "faculty", "visitor", "unknown":
	default:
		return fmt.Errorf("unsupported audience: %s", request.Audience)
	}
	return nil
}

func isAllowedContactDirectoryFocus(value string) bool {
	switch value {
	case "phone", "email", "location", "office_hours", "contact_person", "all_contacts":
		return true
	default:
		return false
	}
}
