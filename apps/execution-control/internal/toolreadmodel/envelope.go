package toolreadmodel

import "encoding/json"

type toolReadModelEnvelope struct {
	Payload json.RawMessage `json:"payload"`
}

func toolReadModelPayloadBody(rawBody []byte) ([]byte, error) {
	var envelope toolReadModelEnvelope
	if err := json.Unmarshal(rawBody, &envelope); err == nil && len(envelope.Payload) > 0 {
		return envelope.Payload, nil
	}
	return rawBody, nil
}
