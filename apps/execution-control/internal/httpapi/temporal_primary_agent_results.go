package httpapi

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

const primaryAgentCitationLimit = 10

var primaryAgentCitationPattern = regexp.MustCompile(`\[([0-9]+)\]`)

type primaryAgentCitationClosure struct {
	Sources []map[string]any
}

type primaryAgentRunResult struct {
	CitationIndex int
	ResultRef     string
	Source        map[string]any
	Text          string
}

func (s *Server) primaryAgentCitationClosureForFinalization(
	agentResult map[string]any,
	answerText string,
) (primaryAgentCitationClosure, error) {
	results, err := primaryAgentResultsFromAgentResult(agentResult)
	if err != nil {
		return primaryAgentCitationClosure{}, err
	}
	sources, err := publicSourcesFromPrimaryAgentCitations(answerText, results)
	if err != nil {
		return primaryAgentCitationClosure{}, err
	}
	return primaryAgentCitationClosure{Sources: sources}, nil
}

func primaryAgentResultsFromAgentResult(agentResult map[string]any) ([]primaryAgentRunResult, error) {
	results := []primaryAgentRunResult{}
	seenIndexes := map[int]struct{}{}
	for _, toolResult := range primaryAgentToolResultMaps(agentResult["tool_results"]) {
		if strings.TrimSpace(stringValue(toolResult["status"])) != "completed" ||
			strings.TrimSpace(stringValue(toolResult["tool_name"])) != campusSearchToolName {
			continue
		}
		_, parsedResults, err := decodeCampusSearchResult(
			cloneAnyMapFromMetadata(toolResult["result"]),
		)
		if err != nil {
			return nil, fmt.Errorf("campus_search result is invalid during finalization: %w", err)
		}
		for _, item := range parsedResults {
			if _, duplicate := seenIndexes[item.CitationIndex]; duplicate {
				return nil, fmt.Errorf("successful campus_search citation_index %d is duplicated", item.CitationIndex)
			}
			seenIndexes[item.CitationIndex] = struct{}{}
			results = append(results, primaryAgentRunResultFromCampusSearch(item))
		}
	}
	return results, nil
}

func primaryAgentRunResultFromCampusSearch(item campusSearchResultItem) primaryAgentRunResult {
	return primaryAgentRunResult{
		CitationIndex: item.CitationIndex,
		ResultRef:     item.ResultRef,
		Text:          item.Text,
		Source: map[string]any{
			"document_id":   item.DocumentID,
			"result_ref":    item.ResultRef,
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
	results []primaryAgentRunResult,
) ([]map[string]any, error) {
	byIndex := make(map[int]primaryAgentRunResult, len(results))
	for _, result := range results {
		byIndex[result.CitationIndex] = result
	}
	seen := map[int]struct{}{}
	sources := []map[string]any{}
	for _, match := range primaryAgentCitationPattern.FindAllStringSubmatch(answerText, -1) {
		index, err := strconv.Atoi(match[1])
		if err != nil || index < 1 || index > primaryAgentCitationLimit {
			return nil, fmt.Errorf("answer references invalid citation index %q", match[1])
		}
		if _, duplicate := seen[index]; duplicate {
			continue
		}
		result, found := byIndex[index]
		if !found {
			return nil, fmt.Errorf("answer references unknown citation index %d", index)
		}
		seen[index] = struct{}{}
		source := cloneAnyMapFromMetadata(result.Source)
		source["citation_index"] = index
		sources = append(sources, source)
	}
	return sources, nil
}

func citedPrimaryAgentResults(
	answerText string,
	results []primaryAgentRunResult,
) ([]primaryAgentRunResult, error) {
	byIndex := make(map[int]primaryAgentRunResult, len(results))
	for _, result := range results {
		if _, duplicate := byIndex[result.CitationIndex]; duplicate {
			return nil, errors.New("citation index is duplicated")
		}
		byIndex[result.CitationIndex] = result
	}
	cited := []primaryAgentRunResult{}
	seenRefs := map[string]struct{}{}
	for _, match := range primaryAgentCitationPattern.FindAllStringSubmatch(answerText, -1) {
		index, err := strconv.Atoi(match[1])
		if err != nil || index < 1 || index > primaryAgentCitationLimit {
			return nil, errors.New("citation index is invalid")
		}
		result, found := byIndex[index]
		if !found {
			return nil, errors.New("citation index is unknown")
		}
		if _, duplicate := seenRefs[result.ResultRef]; duplicate {
			continue
		}
		seenRefs[result.ResultRef] = struct{}{}
		cited = append(cited, result)
	}
	return cited, nil
}
