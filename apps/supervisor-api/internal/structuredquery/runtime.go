package structuredquery

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

func NewRuntime(options Options) *Runtime {
	structuredProjectionDatabaseURL := strings.TrimSpace(options.StructuredProjectionDatabaseURL)
	serviceStatusReadModelStore := options.ServiceStatusReadModelStore
	if serviceStatusReadModelStore == nil {
		serviceStatusReadModelStore = NewPostgresServiceStatusReadModelStore(
			ServiceStatusPostgresOptions{
				DatabaseURL: structuredProjectionDatabaseURL,
			},
		)
	}
	transportScheduleReadModelStore := options.TransportScheduleReadModelStore
	if transportScheduleReadModelStore == nil {
		transportScheduleReadModelStore = NewPostgresTransportScheduleReadModelStore(
			TransportSchedulePostgresOptions{
				DatabaseURL: structuredProjectionDatabaseURL,
			},
		)
	}
	serviceGuideReadModelStore := options.ServiceGuideReadModelStore
	if serviceGuideReadModelStore == nil {
		serviceGuideReadModelStore = NewPostgresServiceGuideReadModelStore(ServiceGuidePostgresOptions{
			DatabaseURL: structuredProjectionDatabaseURL,
		})
	}
	contactDirectoryReadModelStore := options.ContactDirectoryReadModelStore
	if contactDirectoryReadModelStore == nil {
		contactDirectoryReadModelStore = NewPostgresContactDirectoryReadModelStore(
			ContactDirectoryPostgresOptions{
				DatabaseURL: structuredProjectionDatabaseURL,
			},
		)
	}
	academicCalendarReadModelStore := options.AcademicCalendarReadModelStore
	if academicCalendarReadModelStore == nil {
		academicCalendarReadModelStore = NewPostgresAcademicCalendarReadModelStore(
			AcademicCalendarPostgresOptions{
				DatabaseURL: structuredProjectionDatabaseURL,
			},
		)
	}
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
			Endpoint:     strings.TrimSpace(options.NoticeBodyObjectStoreEndpoint),
			AccessKey:    strings.TrimSpace(options.NoticeBodyObjectStoreAccessKey),
			SecretKey:    strings.TrimSpace(options.NoticeBodyObjectStoreSecretKey),
			Region:       strings.TrimSpace(options.NoticeBodyObjectStoreRegion),
			Bucket:       strings.TrimSpace(options.NoticeBodyObjectStoreBucket),
			MaxBodyBytes: options.NoticeBodyObjectStoreBodyLimitBytes,
		})
	}
	runtime := &Runtime{
		serviceStatusReadModelStore:     serviceStatusReadModelStore,
		transportScheduleReadModelStore: transportScheduleReadModelStore,
		serviceGuideReadModelStore:      serviceGuideReadModelStore,
		contactDirectoryReadModelStore:  contactDirectoryReadModelStore,
		academicCalendarReadModelStore:  academicCalendarReadModelStore,
		noticeReadModelStore:            noticeReadModelStore,
		noticeBodyStore:                 noticeBodyStore,
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
	if closer, ok := r.serviceStatusReadModelStore.(interface{ Close() }); ok {
		closer.Close()
	}
	if closer, ok := r.transportScheduleReadModelStore.(interface{ Close() }); ok {
		closer.Close()
	}
	if closer, ok := r.serviceGuideReadModelStore.(interface{ Close() }); ok {
		closer.Close()
	}
	if closer, ok := r.contactDirectoryReadModelStore.(interface{ Close() }); ok {
		closer.Close()
	}
	if closer, ok := r.academicCalendarReadModelStore.(interface{ Close() }); ok {
		closer.Close()
	}
	if closer, ok := r.noticeReadModelStore.(interface{ Close() }); ok {
		closer.Close()
	}
}

func (r *Runtime) LookupTransportSchedule(ctx context.Context, rawBody []byte) Response {
	payloadBody, err := structuredQueryPayloadBody(rawBody)
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
