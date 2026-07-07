package httpapi

import "testing"

func TestProviderConfigSnapshotAcceptsCompatiblePublicWebSearchProvider(t *testing.T) {
	snapshot := providerConfigSnapshot{
		APIKey:    "compatible-key",
		BaseURL:   "https://compatible-search.example",
		Kind:      "search",
		Model:     "sonar-compatible",
		ProfileID: "provider_profile_public_web_search",
		Provider:  "perplexity_compatible",
		Revision:  1,
		Role:      "public_web_search",
		TimeoutMS: 12000,
		Transport: "perplexity_search",
	}

	if err := validateProviderConfigSnapshot(snapshot, providerConfigRolePublicWebSearch); err != nil {
		t.Fatalf("validateProviderConfigSnapshot() error = %v", err)
	}
}

func TestProviderConfigSnapshotAcceptsOpenAIAndGeminiPublicWebSearchProviders(t *testing.T) {
	cases := []providerConfigSnapshot{
		{
			APIKey:    "openai-key",
			BaseURL:   "https://api.openai.com/v1",
			Kind:      "search",
			Model:     "gpt-5-search-api",
			ProfileID: "provider_profile_public_web_search_openai",
			Provider:  "openai",
			Revision:  1,
			Role:      "public_web_search",
			TimeoutMS: 12000,
			Transport: "openai_responses_web_search",
		},
		{
			APIKey:    "gemini-key",
			BaseURL:   "https://generativelanguage.googleapis.com/v1beta",
			Kind:      "search",
			Model:     "gemini-2.5-flash",
			ProfileID: "provider_profile_public_web_search_gemini",
			Provider:  "gemini",
			Revision:  1,
			Role:      "public_web_search",
			TimeoutMS: 12000,
			Transport: "gemini_google_search",
		},
		{
			APIKey:    "linux-do-key",
			BaseURL:   "https://hub.linux.do/v1",
			Kind:      "search",
			Model:     "gpt-5-search-api-2025-10-14",
			ProfileID: "provider_profile_public_web_search_linux_do",
			Provider:  "linux_do",
			Revision:  1,
			Role:      "public_web_search",
			TimeoutMS: 12000,
			Transport: "openai_chat_completions_web_search",
		},
	}

	for _, snapshot := range cases {
		if err := validateProviderConfigSnapshot(snapshot, providerConfigRolePublicWebSearch); err != nil {
			t.Fatalf(
				"validateProviderConfigSnapshot(%s/%s) error = %v",
				snapshot.Provider,
				snapshot.Transport,
				err,
			)
		}
	}
}

func TestProviderConfigSnapshotRejectsMismatchedPublicWebSearchTransport(t *testing.T) {
	snapshot := providerConfigSnapshot{
		APIKey:    "gemini-key",
		BaseURL:   "https://generativelanguage.googleapis.com/v1beta",
		Kind:      "search",
		Model:     "gemini-2.5-flash",
		ProfileID: "provider_profile_public_web_search",
		Provider:  "gemini",
		Revision:  1,
		Role:      "public_web_search",
		TimeoutMS: 12000,
		Transport: "perplexity_search",
	}

	if err := validateProviderConfigSnapshot(snapshot, providerConfigRolePublicWebSearch); err == nil {
		t.Fatal("validateProviderConfigSnapshot() accepted mismatched provider/transport")
	}
}
