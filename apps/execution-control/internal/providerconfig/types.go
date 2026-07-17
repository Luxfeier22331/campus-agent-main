package providerconfig

import "time"

type Role string

const (
	RolePrimaryAgent      Role = "primary_agent"
	RoleRAGQueryEmbedding Role = "rag_query_embedding"
	RoleRAGReranker       Role = "rag_reranker"
)

type RuntimeSnapshot struct {
	APIKey     string         `json:"api_key"`
	BaseURL    string         `json:"base_url"`
	ToolConfig map[string]any `json:"tool_config,omitempty"`
	Dimensions int            `json:"dimensions,omitempty"`
	Kind       string         `json:"kind"`
	Model      string         `json:"model"`
	ProfileID  string         `json:"profile_id"`
	Provider   string         `json:"provider"`
	Revision   int64          `json:"revision"`
	Role       string         `json:"role"`
	TimeoutMS  int            `json:"timeout_ms"`
	Transport  string         `json:"transport"`
}

type ConnectionInput struct {
	APIKey        string         `json:"apiKey"`
	BaseURL       string         `json:"baseUrl"`
	ConnectionID  string         `json:"connectionId"`
	Features      []string       `json:"features"`
	FeatureConfig map[string]any `json:"featureConfig"`
	Provider      string         `json:"provider"`
}

type ProfileInput struct {
	ConnectionID       string `json:"connectionId"`
	ConnectionRevision int64  `json:"connectionRevision"`
	Dimensions         int    `json:"dimensions"`
	Kind               string `json:"kind"`
	Model              string `json:"model"`
	ProfileID          string `json:"profileId"`
	Role               Role   `json:"role"`
	TimeoutMS          int    `json:"timeoutMs"`
	Transport          string `json:"transport"`
}

type ActivationInput struct {
	ExpectedRevision int64           `json:"expectedRevision"`
	Profiles         map[Role]string `json:"profiles"`
}

type ValidationResult struct {
	ErrorCode          string `json:"errorCode,omitempty"`
	Message            string `json:"message"`
	ObservedDimensions int    `json:"observedDimensions,omitempty"`
	Status             string `json:"status"`
}

type Status struct {
	ActiveRevision int64            `json:"activeRevision"`
	Connections    []ConnectionView `json:"connections"`
	Profiles       []ProfileView    `json:"profiles"`
	Roles          []RoleStatus     `json:"roles"`
	SampledAt      time.Time        `json:"sampledAt"`
}

type ConnectionView struct {
	BaseURL           string         `json:"baseUrl"`
	ConnectionID      string         `json:"connectionId"`
	FeatureConfig     map[string]any `json:"featureConfig"`
	Features          []string       `json:"features"`
	Provider          string         `json:"provider"`
	Revision          int64          `json:"revision"`
	SecretFingerprint string         `json:"secretFingerprint"`
	SecretLast4       string         `json:"secretLast4"`
}

type ProfileView struct {
	ConnectionID       string `json:"connectionId"`
	ConnectionRevision int64  `json:"connectionRevision"`
	Dimensions         int    `json:"dimensions,omitempty"`
	Kind               string `json:"kind"`
	Model              string `json:"model"`
	ProfileID          string `json:"profileId"`
	Role               Role   `json:"role"`
	TimeoutMS          int    `json:"timeoutMs"`
	Transport          string `json:"transport"`
	ValidationStatus   string `json:"validationStatus"`
}

type RoleStatus struct {
	Configured bool   `json:"configured"`
	Model      string `json:"model,omitempty"`
	ProfileID  string `json:"profileId,omitempty"`
	Provider   string `json:"provider,omitempty"`
	Role       Role   `json:"role"`
	Transport  string `json:"transport,omitempty"`
}
