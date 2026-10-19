package catalog

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSnapshotResponseUsesRESTScheduleNamesWithoutChangingStoredShape(t *testing.T) {
	snapshot := &Snapshot{Staff: []StaffMember{{
		Schedule: Schedule{Start: "09:00", End: "17:00", BreakStart: "12:00", BreakEnd: "13:00", Days: []int{1}},
	}}}

	responseJSON, err := json.Marshal(snapshotResponse(snapshot))
	if err != nil {
		t.Fatalf("marshal REST response: %v", err)
	}
	if !strings.Contains(string(responseJSON), `"break_start":"12:00"`) {
		t.Fatalf("REST response does not use snake_case schedule keys: %s", responseJSON)
	}
	if strings.Contains(string(responseJSON), "breakStart") {
		t.Fatalf("REST response leaked storage schedule keys: %s", responseJSON)
	}

	storedJSON, err := json.Marshal(snapshot.Staff[0].Schedule)
	if err != nil {
		t.Fatalf("marshal stored schedule: %v", err)
	}
	if !strings.Contains(string(storedJSON), `"breakStart":"12:00"`) {
		t.Fatalf("stored schedule representation changed: %s", storedJSON)
	}
}
