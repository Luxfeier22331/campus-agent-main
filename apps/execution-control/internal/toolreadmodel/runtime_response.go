package toolreadmodel

import "time"

func (r *Runtime) timeAnchor() string {
	if !r.trustedTime.IsZero() {
		return r.trustedTime.Format(time.RFC3339)
	}
	return time.Now().In(time.FixedZone("Asia/Shanghai", 8*60*60)).Format(time.RFC3339)
}

func invalidRequest(message string) Response {
	return Response{
		StatusCode: 400,
		Outcome:    "invalid_request",
		Body: map[string]any{
			"error": map[string]any{
				"code":      "invalid_request",
				"message":   message,
				"retryable": false,
			},
		},
	}
}
