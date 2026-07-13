package toolreadmodel

import (
	"testing"
	"time"
)

func TestDepartureAppliesToServiceDate(t *testing.T) {
	monday := time.Date(2026, time.July, 13, 12, 0, 0, 0, transportLocation)
	sunday := time.Date(2026, time.July, 12, 12, 0, 0, 0, transportLocation)
	tests := []struct {
		name       string
		record     scheduledDepartureRecord
		date       time.Time
		applicable bool
	}{
		{name: "weekday on Monday", record: scheduledDepartureRecord{ServiceMode: "weekday"}, date: monday, applicable: true},
		{name: "weekday on Sunday", record: scheduledDepartureRecord{ServiceMode: "weekday"}, date: sunday, applicable: false},
		{name: "weekend on Sunday", record: scheduledDepartureRecord{ServiceMode: "weekend_holiday"}, date: sunday, applicable: true},
		{name: "weekend on Monday", record: scheduledDepartureRecord{ServiceMode: "weekend_holiday"}, date: monday, applicable: false},
		{name: "daily", record: scheduledDepartureRecord{ServiceMode: "daily"}, date: monday, applicable: true},
		{name: "temporary without date", record: scheduledDepartureRecord{ServiceMode: "temporary"}, date: monday, applicable: false},
		{name: "temporary matching date", record: scheduledDepartureRecord{ServiceMode: "temporary", ServiceDates: []string{"2026-07-13"}}, date: monday, applicable: true},
		{name: "explicit date overrides mode", record: scheduledDepartureRecord{ServiceMode: "weekend_holiday", ServiceDates: []string{"2026-07-13"}}, date: monday, applicable: true},
		{name: "unknown mode", record: scheduledDepartureRecord{ServiceMode: "holiday_except_exam_week"}, date: monday, applicable: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := departureAppliesToServiceDate(test.record, test.date); got != test.applicable {
				t.Fatalf("departureAppliesToServiceDate() = %t, want %t", got, test.applicable)
			}
		})
	}
}
