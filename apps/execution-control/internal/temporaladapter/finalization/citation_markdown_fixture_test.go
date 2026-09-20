package finalization

import (
	"encoding/json"
	"github.com/stretchr/testify/require"
	"os"
	"strings"
	"testing"
)

func TestCitationMarkdownSharedFixtures(t *testing.T) {
	data, err := os.ReadFile("../../../../../packages/contracts/fixtures/citation-markers.v1.json")
	require.NoError(t, err)
	var cases []struct {
		Name    string
		Text    string
		Indexes []int
	}
	require.NoError(t, json.Unmarshal(data, &cases))
	for _, tc := range cases {
		t.Run(tc.Name, func(t *testing.T) {
			indexes := []int{}
			previous := 0
			for _, marker := range scanWorkflowCitationMarkers(tc.Text) {
				require.GreaterOrEqual(t, marker.Start, previous)
				require.LessOrEqual(t, marker.End, len(tc.Text))
				require.True(t, strings.HasPrefix(tc.Text[marker.Start:marker.End], "["))
				require.True(t, strings.HasSuffix(tc.Text[marker.Start:marker.End], "]"))
				indexes = append(indexes, marker.Indexes...)
				previous = marker.End
			}
			require.Equal(t, tc.Indexes, indexes)
		})
	}
}

func BenchmarkCitationMarkdown(b *testing.B) {
	answer := strings.Repeat("中文资料[1][2] 与 [普通链接](https://example.com)。\n\n", 200)
	b.ReportAllocs()
	for b.Loop() {
		scanWorkflowCitationMarkers(answer)
	}
}
