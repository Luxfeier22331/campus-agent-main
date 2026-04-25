package structuredquery

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const defaultPlaceCatalogPath = "configs/ingestion/campus_navigation/place_catalog/seed.v1.json"

var (
	placeQueryPunctuationPattern = regexp.MustCompile(`[？?！!，,。；;：:\s]+`)
	placeQueryLeadingPattern     = regexp.MustCompile(`^(请问|想问下|问下|我想去|我想找|我想知道|带我去|去一下)`)
	placeQueryTrailingPatterns   = []*regexp.Regexp{
		regexp.MustCompile(`(在哪里|在哪儿|在哪|位于哪里|在什么地方|位置在哪)$`),
		regexp.MustCompile(`(怎么去|怎么走|怎么到)$`),
		regexp.MustCompile(`(从哪个门进|从哪进|在哪个门)$`),
	}
)

type placeLookupRequest struct {
	QueryText string `json:"query_text"`
}

type placeLookupResult struct {
	QueryText       string           `json:"query_text"`
	MatchedAlias    string           `json:"matched_alias,omitempty"`
	Outcome         string           `json:"outcome"`
	ResolvedPlace   *placeRef        `json:"resolved_place,omitempty"`
	PlaceCard       *placeCard       `json:"place_card,omitempty"`
	CandidatePlaces []placeCandidate `json:"candidate_places,omitempty"`
	FailCloseReason string           `json:"fail_close_reason,omitempty"`
}

type placeCatalog struct {
	Version                   string        `json:"version"`
	CoordinateReferenceSystem string        `json:"coordinate_reference_system"`
	Places                    []placeRecord `json:"places"`
}

type placeRecord struct {
	PlaceID                   string         `json:"place_id"`
	EntityType                string         `json:"entity_type"`
	DisplayName               string         `json:"display_name"`
	Aliases                   []string       `json:"aliases"`
	CampusScope               string         `json:"campus_scope"`
	CampusArea                string         `json:"campus_area"`
	LocationDescription       string         `json:"location_description"`
	LandmarkHint              string         `json:"landmark_hint"`
	AccessNote                string         `json:"access_note"`
	OpeningNote               string         `json:"opening_note"`
	ServiceTags               []string       `json:"service_tags"`
	PointGeometry             *placeGeoPoint `json:"point_geometry"`
	CoordinateReferenceSystem string         `json:"coordinate_reference_system"`
	SourceRefs                []string       `json:"source_refs"`
	VerificationState         string         `json:"verification_state"`
}

type placeGeoPoint struct {
	Longitude float64 `json:"longitude"`
	Latitude  float64 `json:"latitude"`
}

type placeRef struct {
	PlaceID     string `json:"place_id"`
	EntityType  string `json:"entity_type"`
	DisplayName string `json:"display_name"`
	CampusScope string `json:"campus_scope"`
	CampusArea  string `json:"campus_area,omitempty"`
}

type placeCard struct {
	Place                     placeRef       `json:"place"`
	LocationDescription       string         `json:"location_description"`
	LandmarkHint              string         `json:"landmark_hint,omitempty"`
	AccessNote                string         `json:"access_note,omitempty"`
	OpeningNote               string         `json:"opening_note,omitempty"`
	ServiceTags               []string       `json:"service_tags,omitempty"`
	PointGeometry             *placeGeoPoint `json:"point_geometry,omitempty"`
	CoordinateReferenceSystem string         `json:"coordinate_reference_system,omitempty"`
	SourceRefs                []string       `json:"source_refs,omitempty"`
}

type placeCandidate struct {
	Place             placeRef `json:"place"`
	ClarificationHint string   `json:"clarification_hint,omitempty"`
}

func (r *Runtime) LookupPlace(ctx context.Context, rawBody []byte) Response {
	var request placeLookupRequest
	if err := json.Unmarshal(rawBody, &request); err != nil {
		return invalidRequest("Place lookup request body must be a JSON object.")
	}
	request.QueryText = strings.TrimSpace(request.QueryText)
	if request.QueryText == "" {
		return invalidRequest("query_text is required.")
	}
	if err := ctx.Err(); err != nil {
		return failClosedPlaceLookup(request.QueryText, normalizePlaceQuery(request.QueryText))
	}
	catalog, err := r.loadPlaceCatalog()
	if err != nil {
		return failClosedPlaceLookup(request.QueryText, normalizePlaceQuery(request.QueryText))
	}
	matchedAlias, candidates := resolvePlaceRecords(request.QueryText, catalog.Places)
	if len(candidates) == 0 {
		body := placeLookupResult{
			QueryText:    request.QueryText,
			MatchedAlias: matchedAlias,
			Outcome:      "not_found",
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}
	if len(candidates) > 1 {
		body := placeLookupResult{
			QueryText:       request.QueryText,
			MatchedAlias:    matchedAlias,
			Outcome:         "clarification_required",
			CandidatePlaces: placeCandidateList(candidates),
		}
		return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
	}
	record := candidates[0]
	ref := placeRefFromRecord(record)
	card := placeCardFromRecord(record, catalog)
	body := placeLookupResult{
		QueryText:     request.QueryText,
		MatchedAlias:  matchedAlias,
		Outcome:       "resolved_current",
		ResolvedPlace: &ref,
		PlaceCard:     &card,
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func (r *Runtime) loadPlaceCatalog() (placeCatalog, error) {
	if r.placeCatalogPath == "" {
		return placeCatalog{}, errors.New("place catalog path is not configured")
	}
	raw, err := os.ReadFile(r.placeCatalogPath)
	if err != nil {
		return placeCatalog{}, err
	}
	var catalog placeCatalog
	if err := json.Unmarshal(raw, &catalog); err != nil {
		return placeCatalog{}, err
	}
	return catalog, nil
}

func resolvePlaceRecords(queryText string, records []placeRecord) (string, []placeRecord) {
	normalizedSubject := normalizePlaceQuery(queryText)
	if normalizedSubject == "" {
		return "", nil
	}
	exactCandidates := make([]placeRecord, 0)
	for _, record := range records {
		for _, alias := range normalizedPlaceAliases(record) {
			if normalizedSubject == alias {
				exactCandidates = append(exactCandidates, record)
				break
			}
		}
	}
	if len(exactCandidates) > 0 {
		return normalizedSubject, exactCandidates
	}

	partialCandidates := make([]placeRecord, 0)
	for _, record := range records {
		for _, alias := range normalizedPlaceAliases(record) {
			if strings.Contains(normalizedSubject, alias) || strings.Contains(alias, normalizedSubject) {
				partialCandidates = append(partialCandidates, record)
				break
			}
		}
	}
	return normalizedSubject, partialCandidates
}

func normalizedPlaceAliases(record placeRecord) []string {
	rawAliases := append([]string{record.DisplayName}, record.Aliases...)
	aliases := make([]string, 0, len(rawAliases))
	seen := map[string]struct{}{}
	for _, rawAlias := range rawAliases {
		alias := normalizePlaceQuery(rawAlias)
		if alias == "" {
			continue
		}
		if _, ok := seen[alias]; ok {
			continue
		}
		seen[alias] = struct{}{}
		aliases = append(aliases, alias)
	}
	return aliases
}

func normalizePlaceQuery(queryText string) string {
	normalized := placeQueryPunctuationPattern.ReplaceAllString(queryText, "")
	normalized = placeQueryLeadingPattern.ReplaceAllString(normalized, "")
	for _, pattern := range placeQueryTrailingPatterns {
		normalized = pattern.ReplaceAllString(normalized, "")
	}
	return strings.TrimSpace(normalized)
}

func placeCandidateList(records []placeRecord) []placeCandidate {
	candidates := make([]placeCandidate, 0, len(records))
	for _, record := range records {
		candidates = append(candidates, placeCandidate{
			Place:             placeRefFromRecord(record),
			ClarificationHint: formatPlaceClarificationHint(record),
		})
	}
	return candidates
}

func placeRefFromRecord(record placeRecord) placeRef {
	return placeRef{
		PlaceID:     strings.TrimSpace(record.PlaceID),
		EntityType:  strings.TrimSpace(record.EntityType),
		DisplayName: strings.TrimSpace(record.DisplayName),
		CampusScope: strings.TrimSpace(record.CampusScope),
		CampusArea:  strings.TrimSpace(record.CampusArea),
	}
}

func placeCardFromRecord(record placeRecord, catalog placeCatalog) placeCard {
	coordinateReferenceSystem := strings.TrimSpace(record.CoordinateReferenceSystem)
	if coordinateReferenceSystem == "" {
		coordinateReferenceSystem = strings.TrimSpace(catalog.CoordinateReferenceSystem)
	}
	if coordinateReferenceSystem == "" && record.PointGeometry != nil {
		coordinateReferenceSystem = "EPSG:4326"
	}
	return placeCard{
		Place:                     placeRefFromRecord(record),
		LocationDescription:       strings.TrimSpace(record.LocationDescription),
		LandmarkHint:              strings.TrimSpace(record.LandmarkHint),
		AccessNote:                strings.TrimSpace(record.AccessNote),
		OpeningNote:               strings.TrimSpace(record.OpeningNote),
		ServiceTags:               append([]string(nil), record.ServiceTags...),
		PointGeometry:             record.PointGeometry,
		CoordinateReferenceSystem: coordinateReferenceSystem,
		SourceRefs:                append([]string(nil), record.SourceRefs...),
	}
}

func formatPlaceClarificationHint(record placeRecord) string {
	segments := []string{}
	if label := campusScopeLabel(record.CampusScope); label != "" {
		segments = append(segments, label)
	}
	if campusArea := strings.TrimSpace(record.CampusArea); campusArea != "" {
		segments = append(segments, campusArea)
	}
	return strings.Join(segments, " · ")
}

func campusScopeLabel(campusScope string) string {
	switch strings.ToLower(strings.TrimSpace(campusScope)) {
	case "haidian":
		return "海淀校区"
	case "fengtai":
		return "丰台校区"
	case "hainan":
		return "海南校区"
	default:
		return strings.TrimSpace(campusScope)
	}
}

func failClosedPlaceLookup(queryText string, matchedAlias string) Response {
	body := placeLookupResult{
		QueryText:       queryText,
		MatchedAlias:    matchedAlias,
		Outcome:         "temporarily_unverifiable",
		FailCloseReason: "source_truth_unavailable",
	}
	return Response{StatusCode: 200, Outcome: body.Outcome, Body: body}
}

func resolvePlaceCatalogPath(catalogPath string) string {
	if catalogPath != "" {
		return catalogPath
	}
	workingDir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for dir := workingDir; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, defaultPlaceCatalogPath)
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
	}
}
