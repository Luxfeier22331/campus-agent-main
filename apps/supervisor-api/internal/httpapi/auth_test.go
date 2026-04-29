package httpapi

import (
	"os"
	"strings"
	"testing"
)

func TestAuthSecretComparisonsUseConstantTime(t *testing.T) {
	checks := []struct {
		path      string
		forbidden string
	}{
		{path: "auth.go", forbidden: "== token"},
		{path: "auth.go", forbidden: "!= token"},
		{path: "../execution/request.go", forbidden: "!= sharedSecret"},
	}
	for _, check := range checks {
		t.Run(check.path+" "+check.forbidden, func(t *testing.T) {
			source, err := os.ReadFile(check.path)
			if err != nil {
				t.Fatalf("read %s: %v", check.path, err)
			}
			if strings.Contains(string(source), check.forbidden) {
				t.Fatalf("%s contains direct secret comparison %q", check.path, check.forbidden)
			}
		})
	}
}
