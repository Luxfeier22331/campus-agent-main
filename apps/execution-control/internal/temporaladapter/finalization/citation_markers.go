package finalization

import (
	"regexp"
	"strconv"
	"strings"
)

type workflowCitationMarker struct {
	Start, End int
	Indexes    []int
}

// Links are consumed before bare numeric markers, including nested labels.
var workflowMarkdownTokens = regexp.MustCompile(`^(!?\[(?:[^\[\]\n]|\[[^\]\n]*\])*\](?:\((?:[^()\n]|\([^()\n]*\))*\)|\[[^\]\n]*\]))|^\[([0-9]+(?:[ \t]*,[ \t]*[0-9]+)*)\]`)

func scanWorkflowCitationMarkers(answer string) []workflowCitationMarker {
	markers := []workflowCitationMarker{}
	for pos := 0; pos < len(answer); {
		if answer[pos] == '\\' {
			pos += min(2, len(answer)-pos)
			continue
		}
		if end := citationCodeEnd(answer, pos); end > pos {
			pos = end
			continue
		}
		if answer[pos] != '[' && answer[pos] != '!' {
			pos++
			continue
		}
		match := workflowMarkdownTokens.FindStringSubmatchIndex(answer[pos:])
		if match == nil {
			pos++
			continue
		}
		if match[4] >= 0 {
			marker := workflowCitationMarker{Start: pos, End: pos + match[1]}
			seen := map[int]bool{}
			for _, raw := range strings.Split(answer[pos+match[4]:pos+match[5]], ",") {
				index, err := strconv.Atoi(strings.TrimSpace(raw))
				if err != nil {
					index = 0
				}
				if !seen[index] {
					marker.Indexes = append(marker.Indexes, index)
					seen[index] = true
				}
			}
			markers = append(markers, marker)
		}
		pos += match[1]
	}
	return markers
}

// Fences can contain shorter backtick runs; inline code closes on an equal run.
func citationCodeEnd(text string, start int) int {
	delimiter := text[start]
	if delimiter != '`' && delimiter != '~' {
		return start
	}
	width := 1
	for start+width < len(text) && text[start+width] == delimiter {
		width++
	}
	lineStart := strings.LastIndex(text[:start], "\n") + 1
	fenced := width >= 3 && strings.TrimSpace(text[lineStart:start]) == ""
	if delimiter == '~' && !fenced {
		return start
	}
	for pos := start + width; pos < len(text); {
		if text[pos] != delimiter {
			pos++
			continue
		}
		count := 1
		for pos+count < len(text) && text[pos+count] == delimiter {
			count++
		}
		if !fenced && count == width {
			return pos + count
		}
		if fenced && count >= width {
			beginning := strings.LastIndex(text[:pos], "\n") + 1
			if strings.TrimSpace(text[beginning:pos]) == "" {
				return pos + count
			}
		}
		pos += count
	}
	if fenced {
		return len(text)
	}
	return start
}

func markerAtGroundedTail(answer string, marker workflowCitationMarker, grounded []WorkflowCitation) bool {
	for _, support := range grounded {
		end := support.EndByte
		if end <= marker.Start {
			gap := answer[end:marker.Start]
			if strings.TrimSpace(gap) == "" && strings.Count(gap, "\n") < 2 {
				return true
			}
		} else if support.SupportStartByte <= marker.Start && end <= marker.End {
			return true
		} else if support.SupportStartByte <= marker.Start && marker.End <= end && strings.TrimSpace(answer[marker.End:end]) == "" && strings.Count(answer[marker.End:end], "\n") < 2 {
			return true
		}
	}
	return false
}
