package structuredquery

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

func NewRuntime(options Options) *Runtime {
	noticeReadModelStore := options.NoticeReadModelStore
	if noticeReadModelStore == nil {
		noticeReadModelStore = NewPostgresNoticeReadModelStore(NoticePostgresOptions{
			DatabaseURL: strings.TrimSpace(options.NoticeReadModelDatabaseURL),
			TableName:   strings.TrimSpace(options.NoticeReadModelTable),
		})
	}
	noticeBodyStore := options.NoticeBodyStore
	if noticeBodyStore == nil {
		noticeBodyStore = NewS3NoticeBodyStore(NoticeS3Options{
			Endpoint:      strings.TrimSpace(options.NoticeObjectStoreEndpoint),
			AccessKey:     strings.TrimSpace(options.NoticeObjectStoreAccessKey),
			SecretKey:     strings.TrimSpace(options.NoticeObjectStoreSecretKey),
			Region:        strings.TrimSpace(options.NoticeObjectStoreRegion),
			BucketDerived: strings.TrimSpace(options.NoticeObjectStoreBucketDerived),
			MaxBodyBytes:  options.NoticeObjectStoreBodyLimitBytes,
		})
	}
	runtime := &Runtime{
		projectionPath:             strings.TrimSpace(options.ProjectionPath),
		serviceGuideProjectionPath: strings.TrimSpace(options.ServiceGuideProjectionPath),
		noticeReadModelStore:       noticeReadModelStore,
		noticeBodyStore:            noticeBodyStore,
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
	if closer, ok := r.noticeReadModelStore.(interface{ Close() }); ok {
		closer.Close()
	}
}

func (r *Runtime) LookupTransportSchedule(ctx context.Context, rawBody []byte) Response {
	var request transportScheduleRequest
	if err := json.Unmarshal(rawBody, &request); err != nil {
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
