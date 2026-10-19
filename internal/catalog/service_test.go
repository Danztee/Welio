package catalog

import (
	"strconv"
	"strings"
	"testing"
)

func TestValidateStaffScheduleAndNormalizeDays(t *testing.T) {
	staff := StaffInput{Name: "  Ade Staff  ", Email: "ade@example.test", JobTitle: "Cleaner", Schedule: Schedule{
		Start: "09:00", End: "17:00", BreakStart: "12:00", BreakEnd: "12:30", Days: []int{4, 1, 4},
	}}
	if err := validateStaff(&staff); err != nil {
		t.Fatalf("validateStaff() = %v", err)
	}
	if staff.Name != "Ade Staff" || strings.Join(intStrings(staff.Schedule.Days), ",") != "1,4" {
		t.Fatalf("normalized staff = %+v", staff)
	}
}

func TestValidateStaffRejectsInvalidBreakAndDays(t *testing.T) {
	tests := []struct {
		name     string
		schedule Schedule
	}{
		{name: "partial break", schedule: Schedule{Start: "09:00", End: "17:00", BreakStart: "12:00", Days: []int{1}}},
		{name: "break outside hours", schedule: Schedule{Start: "09:00", End: "17:00", BreakStart: "17:00", BreakEnd: "17:30", Days: []int{1}}},
		{name: "invalid day", schedule: Schedule{Start: "09:00", End: "17:00", Days: []int{7}}},
		{name: "no working days", schedule: Schedule{Start: "09:00", End: "17:00"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := StaffInput{Name: "Ade Staff", Email: "ade@example.test", Schedule: test.schedule}
			if err := validateStaff(&input); err == nil {
				t.Fatal("invalid schedule was accepted")
			}
		})
	}
}

func TestValidateServicePriceAndBounds(t *testing.T) {
	valid := ServiceInput{Name: "Standard cleaning", DurationMinutes: 60, Price: 15000.25}
	if err := validateService(valid); err != nil {
		t.Fatalf("valid service: %v", err)
	}
	for _, price := range []float64{-1, 10000001, 10.001} {
		input := valid
		input.Price = price
		if err := validateService(input); err == nil {
			t.Errorf("price %v was accepted", price)
		}
	}
}

func intStrings(values []int) []string {
	result := make([]string, len(values))
	for index, value := range values {
		result[index] = strconv.Itoa(value)
	}
	return result
}
