package providerconfig

import (
	"errors"
	"fmt"
	"strings"
)

func ValidateRuntimeSetting(setting RuntimeSetting, kind Kind) error {
	required := []struct {
		name  string
		value string
	}{
		{"api_key", setting.APIKey},
		{"base_url", setting.BaseURL},
		{"model", setting.Model},
		{"provider", setting.Provider},
		{"transport", setting.Transport},
	}
	for _, item := range required {
		if strings.TrimSpace(item.value) == "" {
			return fmt.Errorf("provider config snapshot %s is required", item.name)
		}
	}
	if setting.Kind != kind {
		return fmt.Errorf("provider config snapshot kind = %q, want %q", setting.Kind, kind)
	}
	if kind == KindEmbedding {
		if setting.Provider != CanonicalEmbeddingProvider {
			return fmt.Errorf("embedding provider config snapshot provider = %q, want %q", setting.Provider, CanonicalEmbeddingProvider)
		}
		if setting.Model != CanonicalEmbeddingModel {
			return fmt.Errorf("embedding provider config snapshot model = %q, want %q", setting.Model, CanonicalEmbeddingModel)
		}
		if setting.Transport != CanonicalEmbeddingTransport {
			return fmt.Errorf("embedding provider config snapshot transport must be %s", CanonicalEmbeddingTransport)
		}
	} else if isTextModelKind(kind) && setting.Transport != "responses" && setting.Transport != "chat_completions" {
		return errors.New("text model provider config snapshot transport is invalid")
	}
	return nil
}
