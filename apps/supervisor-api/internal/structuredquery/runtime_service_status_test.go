package structuredquery

import (
	"context"
	"testing"
)

func TestLookupServiceStatusFailsClosedWhenEffectiveWindowExpired(t *testing.T) {
	runtime := newRuntimeWithServiceStatusReadModel(
		t,
		serviceStatusProjectionFixture(),
		"2026-04-25T10:30:00+08:00",
	)

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"海淀校区图书馆今天开门吗",
		"temporal_query":{"mode":"current"},
		"campus_scope":"haidian"
	}`))

	if response.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	result, ok := response.Body.(serviceStatusResult)
	if !ok {
		t.Fatalf("body = %T, want serviceStatusResult", response.Body)
	}
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "current_state_unverifiable" {
		t.Fatalf("fail_close_reason = %q, want current_state_unverifiable", result.FailCloseReason)
	}
}

func TestLookupServiceStatusReadsPostgresReadModelWithoutProjectionPath(t *testing.T) {
	runtime := NewRuntime(Options{
		ServiceStatusReadModelStore: &fakeServiceStatusReadModelStore{
			bundle: mustProjectionBundle(t, serviceStatusProjectionFixture()),
		},
		TrustedTimeRFC3339: "2026-04-24T10:30:00+08:00",
	})

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"海淀校区图书馆今天开门吗",
		"temporal_query":{"mode":"current"},
		"campus_scope":"haidian"
	}`))

	result := response.Body.(serviceStatusResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedSubject != "海淀校区图书馆" {
		t.Fatalf("resolved_subject = %q", result.ResolvedSubject)
	}
	if result.StatusNote != "工作日开放，节假日另行通知" {
		t.Fatalf("status_note = %q", result.StatusNote)
	}
	status := runtime.Status(context.Background())
	if status.ProjectionSource != "postgres" || !status.ServiceStatusReadModelConfigured {
		t.Fatalf("status = %#v", status)
	}
}

func TestLookupServiceStatusSelectsNarrowTemporaryOverride(t *testing.T) {
	runtime := newRuntimeWithServiceStatusReadModel(
		t,
		serviceStatusProjectionFixtureWithTemporaryOverride(),
		"2026-04-24T13:30:00+08:00",
	)

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"图书馆今天开门吗",
		"temporal_query":{"mode":"current"},
		"campus_scope":"haidian"
	}`))

	result := response.Body.(serviceStatusResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ObservedStatus != "temporarily_closed" {
		t.Fatalf("observed_status = %q, want temporarily_closed", result.ObservedStatus)
	}
	if result.StatusNote != "13:00-18:00 因活动临时闭馆" {
		t.Fatalf("status_note = %q", result.StatusNote)
	}
	if result.EffectiveFrom != "2026-04-24T13:00:00+08:00" {
		t.Fatalf("effective_from = %q", result.EffectiveFrom)
	}
	if len(result.OverrideSourceRefs) != 1 ||
		result.OverrideSourceRefs[0] != "notice:library-temporary-close" {
		t.Fatalf("override_source_refs = %#v", result.OverrideSourceRefs)
	}
}

func TestLookupServiceStatusFailsClosedOnConflictingCurrentRecords(t *testing.T) {
	runtime := newRuntimeWithServiceStatusReadModel(
		t,
		serviceStatusProjectionFixtureWithConflictingCurrentRecords(),
		"2026-04-24T13:30:00+08:00",
	)

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"海淀校区图书馆今天开门吗",
		"temporal_query":{"mode":"current"},
		"campus_scope":"haidian"
	}`))

	result := response.Body.(serviceStatusResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_conflict" {
		t.Fatalf("fail_close_reason = %q, want source_conflict", result.FailCloseReason)
	}
}

func TestLookupServiceStatusFailsClosedWhenMatchedRecordIsIncomplete(t *testing.T) {
	runtime := newRuntimeWithServiceStatusReadModel(
		t,
		incompleteServiceStatusProjectionFixture(),
		"2026-04-24T10:30:00+08:00",
	)

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"图书馆今天开门吗",
		"temporal_query":{"mode":"current"},
		"campus_scope":"haidian"
	}`))

	result := response.Body.(serviceStatusResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.FailCloseReason != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %q, want source_truth_unavailable", result.FailCloseReason)
	}
}

func TestLookupServiceStatusRejectsUnknownSourceObservedStatus(t *testing.T) {
	runtime := newRuntimeWithServiceStatusReadModel(
		t,
		serviceStatusProjectionFixtureWithUnknownSourceStatus(),
		"2026-04-24T10:30:00+08:00",
	)

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"图书馆今天开门吗",
		"temporal_query":{"mode":"current"},
		"campus_scope":"haidian"
	}`))

	result := response.Body.(serviceStatusResult)
	if result.Outcome != "temporarily_unverifiable" {
		t.Fatalf("outcome = %q, want temporarily_unverifiable", result.Outcome)
	}
	if result.ObservedStatus != "unknown" {
		t.Fatalf("observed_status = %q, want fail-close unknown", result.ObservedStatus)
	}
	if result.FailCloseReason != "source_truth_unavailable" {
		t.Fatalf("fail_close_reason = %q, want source_truth_unavailable", result.FailCloseReason)
	}
}

func TestLookupServiceStatusMatchesPlatformRefs(t *testing.T) {
	runtime := newRuntimeWithServiceStatusReadModel(
		t,
		serviceStatusProjectionFixtureWithPlatformRefs(),
		"2026-04-28T02:30:00+08:00",
	)

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"信息门户现在能用吗",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(serviceStatusResult)
	if result.Outcome != "resolved_current" {
		t.Fatalf("outcome = %q, want resolved_current", result.Outcome)
	}
	if result.ResolvedSubject != "统一身份认证平台" {
		t.Fatalf("resolved_subject = %q", result.ResolvedSubject)
	}
	if result.ObservedStatus != "temporarily_closed" {
		t.Fatalf("observed_status = %q, want temporarily_closed", result.ObservedStatus)
	}
}

func TestLookupServiceStatusRequiresClarificationForAmbiguousCampusSubjects(t *testing.T) {
	runtime := newRuntimeWithServiceStatusReadModel(
		t,
		serviceStatusProjectionFixtureWithAmbiguousCampusSubjects(),
		"2026-04-24T10:30:00+08:00",
	)

	response := runtime.LookupServiceStatus(context.Background(), []byte(`{
		"subject_query":"图书馆今天开门吗",
		"temporal_query":{"mode":"current"}
	}`))

	result := response.Body.(serviceStatusResult)
	if result.Outcome != "clarification_required" {
		t.Fatalf("outcome = %q, want clarification_required", result.Outcome)
	}
	if result.FailCloseReason != "" {
		t.Fatalf("fail_close_reason = %q, want empty", result.FailCloseReason)
	}
}
