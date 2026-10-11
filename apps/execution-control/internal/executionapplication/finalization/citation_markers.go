package finalization

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/yuin/goldmark"
	"github.com/yuin/goldmark/ast"
	"github.com/yuin/goldmark/extension"
	"github.com/yuin/goldmark/text"
)

type workflowCitationMarker struct {
	Start, End int
	Indexes    []int
}

var citationMarkdown = goldmark.New(goldmark.WithExtensions(extension.GFM))
var numericCitation = regexp.MustCompile(`\[([0-9]+(?:[ \t]*,[ \t]*[0-9]+)*)\]`)

// Markdown owns syntax boundaries. Inspect original text, preserving byte
// offsets for the existing grounding validation and single-pass rewrite.
func scanWorkflowCitationMarkers(answer string) []workflowCitationMarker {
	source := []byte(answer)
	document := citationMarkdown.Parser().Parse(text.NewReader(source))
	markers := []workflowCitationMarker{}
	_ = ast.Walk(document, func(node ast.Node, entering bool) (ast.WalkStatus, error) {
		if !entering {
			return ast.WalkContinue, nil
		}
		switch node.Kind() {
		case ast.KindLink, ast.KindAutoLink, ast.KindImage, ast.KindCodeSpan, ast.KindCodeBlock, ast.KindFencedCodeBlock, ast.KindHTMLBlock, ast.KindRawHTML:
			return ast.WalkSkipChildren, nil
		}
		n, ok := node.(*ast.Text)
		if !ok {
			return ast.WalkContinue, nil
		}
		if previous, ok := n.PreviousSibling().(*ast.Text); ok && previous.Segment.Stop == n.Segment.Start {
			return ast.WalkContinue, nil
		}
		end := n.Segment.Stop
		for sibling := n.NextSibling(); sibling != nil; sibling = sibling.NextSibling() {
			next, ok := sibling.(*ast.Text)
			if !ok || next.Segment.Start != end {
				break
			}
			end = next.Segment.Stop
		}
		for _, match := range numericCitation.FindAllSubmatchIndex(source[n.Segment.Start:end], -1) {
			start := n.Segment.Start + match[0]
			escapes := 0
			for i := start - 1; i >= 0 && source[i] == '\\'; i-- {
				escapes++
			}
			if escapes%2 != 0 {
				continue
			}
			marker := workflowCitationMarker{Start: start, End: n.Segment.Start + match[1]}
			seen := map[int]bool{}
			for _, raw := range strings.Split(answer[n.Segment.Start+match[2]:n.Segment.Start+match[3]], ",") {
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
		return ast.WalkContinue, nil
	})
	return markers
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
