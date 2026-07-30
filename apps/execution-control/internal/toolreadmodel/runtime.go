package toolreadmodel

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

func NewRuntime(options Options) *Runtime {
	structuredProjectionDatabaseURL := strings.TrimSpace(options.DatabaseURL)
	knowledgeReadModelStore := options.KnowledgeReadModelStore
	if knowledgeReadModelStore == nil {
		knowledgeReadModelStore = NewPostgresKnowledgeReadModelStore(structuredProjectionDatabaseURL)
	}
	transportScheduleReadModelStore := options.TransportScheduleReadModelStore
	if transportScheduleReadModelStore == nil {
		transportScheduleReadModelStore = NewPostgresTransportScheduleReadModelStore(
			TransportSchedulePostgresOptions{
				DatabaseURL: structuredProjectionDatabaseURL,
			},
		)
	}
	runtime := &Runtime{
		knowledgeReadModelStore:         knowledgeReadModelStore,
		transportScheduleReadModelStore: transportScheduleReadModelStore,
	}
	if trustedTime := strings.TrimSpace(options.TrustedTimeRFC3339); trustedTime != "" {
		parsed, err := time.Parse(time.RFC3339, trustedTime)
		if err == nil {
			runtime.trustedTime = parsed
		}
	}
	return runtime
}

func (r *Runtime) Close() {
	if closer, ok := r.knowledgeReadModelStore.(interface{ Close() }); ok {
		closer.Close()
	}
	if closer, ok := r.transportScheduleReadModelStore.(interface{ Close() }); ok {
		closer.Close()
	}
}

func (r *Runtime) CurrentKnowledgeRelease(
	ctx context.Context,
	documentScope string,
) (KnowledgeServingRelease, bool, error) {
	if r == nil || r.knowledgeReadModelStore == nil {
		return KnowledgeServingRelease{}, false, errors.New("knowledge read model store is not configured")
	}
	return r.knowledgeReadModelStore.CurrentRelease(ctx, documentScope)
}

func (r *Runtime) KnowledgeHealthCheck(ctx context.Context) error {
	if r == nil || r.knowledgeReadModelStore == nil {
		return errors.New("knowledge read model store is not configured")
	}
	return r.knowledgeReadModelStore.HealthCheck(ctx)
}

func (r *Runtime) LookupTransportSchedule(ctx context.Context, rawBody []byte) Response {
	payloadBody, err := toolReadModelPayloadBody(rawBody)
	if err != nil {
		return invalidRequest("Transport schedule request body must be a JSON object.")
	}
	var request transportScheduleRequest
	if err := json.Unmarshal(payloadBody, &request); err != nil {
		return invalidRequest("Transport schedule request body must be a JSON object.")
	}
	request.QueryText = strings.TrimSpace(request.QueryText)
	request.Intent = strings.TrimSpace(request.Intent)
	normalizeTransportScheduleRequest(&request)
	if request.QueryText == "" {
		return invalidRequest("query_text is required.")
	}
	if request.Intent == "" {
		return invalidRequest("intent is required.")
	}
	if err := validateTransportScheduleRequest(request); err != nil {
		return invalidRequest(err.Error())
	}
	if err := ctx.Err(); err != nil {
		return failClosedTransportSchedule(request, r.timeAnchor())
	}
	return r.lookupTransportSchedule(ctx, request)
}
