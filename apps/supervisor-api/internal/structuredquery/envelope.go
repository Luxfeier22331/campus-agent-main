package structuredquery

import "encoding/json"

type structuredQueryEnvelope struct {
	Payload json.RawMessage `json:"payload"`
}

func structuredQueryPayloadBody(rawBody []byte) ([]byte, error) {
	var envelope structuredQueryEnvelope
	if err := json.Unmarshal(rawBody, &envelope); err == nil && len(envelope.Payload) > 0 {
		return envelope.Payload, nil
	}
	return rawBody, nil
}
