package agent

import (
	"strings"
	"testing"
	"time"

	"orbit/internal/model"
)

// at builds a local time and checks its weekday, so a wrong date fails here rather than in the schedule assertions.
func at(t *testing.T, y int, mo time.Month, d, h, min int, wd time.Weekday) time.Time {
	t.Helper()
	tm := time.Date(y, mo, d, h, min, 0, 0, time.Local)
	if tm.Weekday() != wd {
		t.Fatalf("%v is a %v, want %v", tm, tm.Weekday(), wd)
	}
	return tm
}

func TestNextSlotIsStrictlyAfterNow(t *testing.T) {
	thursday := model.Automation{Days: []int{4}, Time: "15:00"}
	now := at(t, 2026, 11, 12, 14, 0, time.Thursday)

	got, ok := nextSlot(thursday, now)
	if !ok || !got.Equal(at(t, 2026, 11, 12, 15, 0, time.Thursday)) {
		t.Fatalf("before 3 PM: next = %v, ok = %v", got, ok)
	}

	// Exactly on the slot: that run is already due, so the next one is a week later.
	got, _ = nextSlot(thursday, at(t, 2026, 11, 12, 15, 0, time.Thursday))
	if !got.Equal(at(t, 2026, 11, 19, 15, 0, time.Thursday)) {
		t.Fatalf("on the slot: next = %v", got)
	}

	got, _ = nextSlot(thursday, at(t, 2026, 11, 13, 10, 0, time.Friday))
	if !got.Equal(at(t, 2026, 11, 19, 15, 0, time.Thursday)) {
		t.Fatalf("Friday: next = %v", got)
	}
}

func TestLatestSlotIsAtOrBeforeNow(t *testing.T) {
	thursday := model.Automation{Days: []int{4}, Time: "15:00"}

	got, ok := latestSlot(thursday, at(t, 2026, 11, 12, 14, 0, time.Thursday))
	if !ok || !got.Equal(at(t, 2026, 11, 5, 15, 0, time.Thursday)) {
		t.Fatalf("before 3 PM: latest = %v, ok = %v", got, ok)
	}

	got, _ = latestSlot(thursday, at(t, 2026, 11, 12, 15, 30, time.Thursday))
	if !got.Equal(at(t, 2026, 11, 12, 15, 0, time.Thursday)) {
		t.Fatalf("after 3 PM: latest = %v", got)
	}
}

func TestSeveralWeekdays(t *testing.T) {
	// Monday, Wednesday and Friday at 09:00.
	mwf := model.Automation{Days: []int{1, 3, 5}, Time: "09:00"}

	// Sunday morning: the next run is Monday.
	got, ok := nextSlot(mwf, at(t, 2026, 11, 8, 10, 0, time.Sunday))
	if !ok || !got.Equal(at(t, 2026, 11, 9, 9, 0, time.Monday)) {
		t.Fatalf("next after Sunday = %v, ok = %v", got, ok)
	}
	// Monday evening: the latest run was Monday morning.
	got, _ = latestSlot(mwf, at(t, 2026, 11, 9, 18, 0, time.Monday))
	if !got.Equal(at(t, 2026, 11, 9, 9, 0, time.Monday)) {
		t.Fatalf("latest on Monday evening = %v", got)
	}
}

func TestNoScheduleWithoutTime(t *testing.T) {
	if _, ok := nextSlot(model.Automation{Days: []int{4}, Time: "3pm"}, time.Now()); ok {
		t.Fatal("an unparseable time must not produce a slot")
	}
}

func TestNormaliseDaysSortsAndDedupes(t *testing.T) {
	got, err := normaliseDays([]int{5, 1, 5, 3})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0] != 1 || got[1] != 3 || got[2] != 5 {
		t.Fatalf("got %v, want [1 3 5]", got)
	}
	if _, err := normaliseDays([]int{7}); err == nil {
		t.Fatal("day 7 must be rejected")
	}
	if _, err := normaliseDays(nil); err == nil {
		t.Fatal("no days must be rejected")
	}
}

func TestNormaliseAutomationExplainsWhatIsMissing(t *testing.T) {
	valid := model.Automation{Name: " Weekly review ", ProjectID: "p", Provider: "fake", Task: "Review", Days: []int{4}, Time: "15:00"}
	got, err := normaliseAutomation(valid)
	if err != nil {
		t.Fatalf("valid automation rejected: %v", err)
	}
	if got.Name != "Weekly review" {
		t.Fatalf("name not trimmed: %q", got.Name)
	}

	cases := map[string]func(*model.Automation){
		"give the automation a name": func(a *model.Automation) { a.Name = "  " },
		"choose a project":           func(a *model.Automation) { a.ProjectID = "" },
		"choose a provider":          func(a *model.Automation) { a.Provider = "" },
		"write the task":             func(a *model.Automation) { a.Task = "" },
		"the time must look like":    func(a *model.Automation) { a.Time = "3 PM" },
		"choose at least one day":    func(a *model.Automation) { a.Days = nil },
		"characters or fewer":        func(a *model.Automation) { a.Name = strings.Repeat("x", maxAutomationName+1) },
	}
	for want, mutate := range cases {
		a := valid
		mutate(&a)
		_, err := normaliseAutomation(a)
		if err == nil || !strings.Contains(err.Error(), want) {
			t.Errorf("want error containing %q, got %v", want, err)
		}
	}
}

func TestSaveAutomationRejectsUnknownPermissionMode(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{}
	proj, err := m.CreateProject("Demo", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	_, err = m.SaveAutomation(model.Automation{Name: "x", ProjectID: proj.ID, Provider: "fake", PermissionMode: "nope", Task: "t", Days: []int{1}, Time: "09:00", Enabled: true})
	if err == nil {
		t.Fatal("an unknown permission mode must be rejected")
	}
}

// A due automation launches one agent for its slot, and does not launch again for the same slot.
func TestRunDueAutomationLaunchesOnceForTheSlot(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{}
	proj, err := m.CreateProject("Demo", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	list, err := m.SaveAutomation(model.Automation{Name: "Daily", ProjectID: proj.ID, Provider: "fake", Task: "check", Days: []int{0, 1, 2, 3, 4, 5, 6}, Time: "09:00", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].NextRunAt == 0 {
		t.Fatalf("saved automation should report a next run: %+v", list)
	}

	slot, ok := nextSlot(list[0], time.Now())
	if !ok {
		t.Fatal("no next slot")
	}
	// The slot's time has come, so it is due. Saving set LastRunAt to now, so the slot is after it.
	due := slot.Add(time.Minute)
	if n := m.RunDueAutomations(due); n != 1 {
		t.Fatalf("first tick handled %d, want 1", n)
	}
	if n := m.RunDueAutomations(due.Add(time.Minute)); n != 0 {
		t.Fatalf("second tick handled %d, want 0 (slot already handled)", n)
	}
	if got := len(m.Agents()); got != 1 {
		t.Fatalf("agents = %d, want 1", got)
	}
	if !strings.Contains(m.Agents()[0].Name, "Daily") {
		t.Fatalf("agent name should carry the automation name: %q", m.Agents()[0].Name)
	}
}

// A slot that passed while Orbit was closed is skipped, not run late.
func TestMissedSlotIsSkipped(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{}
	proj, _ := m.CreateProject("Demo", t.TempDir())
	list, err := m.SaveAutomation(model.Automation{Name: "Late", ProjectID: proj.ID, Provider: "fake", Task: "check", Days: []int{0, 1, 2, 3, 4, 5, 6}, Time: "09:00", Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	slot, _ := nextSlot(list[0], time.Now())

	if n := m.RunDueAutomations(slot.Add(automationGrace + time.Minute)); n != 1 {
		t.Fatalf("missed slot handled = %d, want 1", n)
	}
	if got := len(m.Agents()); got != 0 {
		t.Fatalf("a missed slot must not launch an agent, got %d", got)
	}
	if got := m.Automations()[0].LastError; !strings.Contains(got, "Skipped") {
		t.Fatalf("last error should explain the skip, got %q", got)
	}
}

func TestDisabledAutomationNeverFires(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{}
	proj, _ := m.CreateProject("Demo", t.TempDir())
	list, err := m.SaveAutomation(model.Automation{Name: "Off", ProjectID: proj.ID, Provider: "fake", Task: "check", Days: []int{0, 1, 2, 3, 4, 5, 6}, Time: "09:00", Enabled: false})
	if err != nil {
		t.Fatal(err)
	}
	if list[0].NextRunAt != 0 {
		t.Fatal("a disabled automation must not report a next run")
	}
	slot, _ := nextSlot(model.Automation{Days: list[0].Days, Time: list[0].Time}, time.Now())
	if n := m.RunDueAutomations(slot.Add(time.Minute)); n != 0 {
		t.Fatalf("disabled automation handled %d slots", n)
	}
}

func TestDeletingProjectRemovesItsAutomations(t *testing.T) {
	m, _, _ := newTestManager(t)
	m.providers["fake"] = fakeProvider{}
	proj, _ := m.CreateProject("Demo", t.TempDir())
	if _, err := m.SaveAutomation(model.Automation{Name: "x", ProjectID: proj.ID, Provider: "fake", Task: "t", Days: []int{1}, Time: "09:00", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if err := m.DeleteProject(proj.ID); err != nil {
		t.Fatal(err)
	}
	if got := len(m.Automations()); got != 0 {
		t.Fatalf("automations left after deleting their project: %d", got)
	}
}
