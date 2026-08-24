package httpapi

import (
	"errors"
	"fmt"
	"regexp"
	"strings"
)

const primaryAgentEvidenceLimit = 5

var primaryAgentCitationPattern = regexp.MustCompile(`\[([1-5])\]`)

type primaryAgentEvidenceClosure struct {
	Sources []map[string]any
}

type primaryAgentRunEvidence struct {
	EvidenceRef string
	Source      map[string]any
}

func (s *Server) primaryAgentEvidenceClosureForFinalization(
	agentResult map[string]any,
	answerText string,
) (primaryAgentEvidenceClosure, error) {
	evidence, err := primaryAgentEvidenceFromAgentResult(agentResult)
	if err != nil {
		return primaryAgentEvidenceClosure{}, err
	}
	return primaryAgentEvidenceClosure{
		Sources: publicSourcesFromPrimaryAgentCitations(answerText, evidence),
	}, nil
}

func primaryAgentEvidenceFromAgentResult(agentResult map[string]any) ([]primaryAgentRunEvidence, error) {
	evidence := []primaryAgentRunEvidence{}
	seen := map[string]struct{}{}
	for _, toolResult := range primaryAgentToolResultMaps(agentResult["tool_results"]) {
		if strings.TrimSpace(stringValue(toolResult["status"])) != "completed" {
			continue
		}
		toolName := strings.TrimSpace(stringValue(toolResult["tool_name"]))
		result := cloneAnyMapFromMetadata(toolResult["result"])
		var toolEvidence []primaryAgentRunEvidence
		switch toolName {
		case campusSearchToolName:
			_, parsedEvidence, err := decodeCampusSearchResult(result)
			if err != nil {
				return nil, fmt.Errorf("campus_search result is invalid during finalization: %w", err)
			}
			toolEvidence = make([]primaryAgentRunEvidence, 0, len(parsedEvidence))
			for _, item := range parsedEvidence {
				toolEvidence = append(toolEvidence, primaryAgentRunEvidenceFromCampusSearch(item))
			}
		default:
			continue
		}
		for _, item := range toolEvidence {
			if item.EvidenceRef == "" {
				return nil, errors.New("successful tool evidence_ref is required")
			}
			if _, duplicate := seen[item.EvidenceRef]; duplicate {
				return nil, fmt.Errorf("successful tool evidence_ref %q is duplicated", item.EvidenceRef)
			}
			seen[item.EvidenceRef] = struct{}{}
			evidence = append(evidence, item)
		}
	}
	return evidence, nil
}

func primaryAgentRunEvidenceFromCampusSearch(item campusSearchEvidence) primaryAgentRunEvidence {
	return primaryAgentRunEvidence{
		EvidenceRef: item.EvidenceRef,
		Source: map[string]any{
			"document_id":   item.DocumentID,
			"evidence_ref":  item.EvidenceRef,
			"kind":          "campus_document",
			"root_unit_ids": append([]string{}, item.RootUnitIDs...),
			"section_ref":   item.SectionRef,
			"section_title": item.SectionTitle,
			"snippet":       boundedCampusDocsSourceSnippet(item.Text),
			"title":         item.Title,
			"version_id":    item.VersionID,
			"version_label": item.VersionLabel,
			"version_slug":  item.VersionSlug,
		},
	}
}

func publicSourcesFromPrimaryAgentCitations(
	answerText string,
	evidence []primaryAgentRunEvidence,
) []map[string]any {
	seen := map[int]struct{}{}
	sources := []map[string]any{}
	for _, match := range primaryAgentCitationPattern.FindAllStringSubmatch(answerText, -1) {
		index := int(match[1][0] - '0')
		if _, duplicate := seen[index]; duplicate {
			continue
		}
		seen[index] = struct{}{}
		if index > len(evidence) {
			continue
		}
		source := cloneAnyMapFromMetadata(evidence[index-1].Source)
		source["citation_index"] = index
		sources = append(sources, source)
	}
	return sources
}
