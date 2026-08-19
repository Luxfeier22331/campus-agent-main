package providerconfig

import "time"

type Kind string

const (
	KindLLM              Kind = "llm"
	KindEmbedding        Kind = "embedding"
	KindNoticeClassifier Kind = "notice_classifier"
)

type RuntimeSetting struct {
	APIKey    string `json:"api_key"`
	BaseURL   string `json:"base_url"`
	Kind      Kind   `json:"kind"`
	Model     string `json:"model"`
	Provider  string `json:"provider"`
	Transport string `json:"transport"`
}

type SettingInput struct {
	APIKey    string
	BaseURL   string
	Kind      Kind
	Model     string
	Provider  string
	Transport string
}

type ValidationResult struct {
	ErrorCode          string `json:"errorCode,omitempty"`
	Message            string `json:"message"`
	ObservedDimensions int    `json:"observedDimensions,omitempty"`
	Status             string `json:"status"`
}

type LatestValidationView struct {
	ErrorCode          string    `json:"errorCode,omitempty"`
	Message            string    `json:"message"`
	ObservedDimensions int       `json:"observedDimensions,omitempty"`
	Status             string    `json:"status"`
	ValidatedAt        time.Time `json:"validatedAt"`
	ValidatedBy        string    `json:"validatedBy"`
}

type SettingView struct {
	BaseURL              string                `json:"baseUrl"`
	CredentialConfigured bool                  `json:"credentialConfigured"`
	Kind                 Kind                  `json:"kind"`
	LatestValidation     *LatestValidationView `json:"latestValidation"`
	Model                string                `json:"model"`
	Provider             string                `json:"provider"`
	Transport            string                `json:"transport"`
	UpdatedAt            time.Time             `json:"updatedAt"`
	UpdatedBy            string                `json:"updatedBy"`
}

type EmbeddingContractView struct {
	Dimensions int    `json:"dimensions"`
	Model      string `json:"model"`
	Provider   string `json:"provider"`
	Transport  string `json:"transport"`
}

type Status struct {
	EmbeddingContract EmbeddingContractView `json:"embeddingContract"`
	SampledAt         time.Time             `json:"sampledAt"`
	Settings          map[Kind]*SettingView `json:"settings"`
}
