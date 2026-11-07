package agent

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"orbit/internal/model"
)

// automationGrace is how late a scheduled run may start. A later slot is skipped, so a laptop
// that slept through 3 PM does not launch its agent at 6 PM.
const automationGrace = 10 * time.Minute

const maxAutomationName = 60

// ErrAutomationNotFound is returned when an automation id no longer exists.
var ErrAutomationNotFound = errors.New("that automation no longer exists")

// ---- schedule maths (pure) ----------------------------------------------------

// normaliseAutomation checks the user's fields and returns them in stored form. It does not check
// the project or provider, which need the manager's state.
func normaliseAutomation(a model.Automation) (model.Automation, error) {
	a.Name = strings.TrimSpace(a.Name)
	a.Task = strings.TrimSpace(a.Task)
	a.Provider = strings.TrimSpace(a.Provider)
	a.Model = strings.TrimSpace(a.Model)
	a.PermissionMode = strings.TrimSpace(a.PermissionMode)
	a.Time = strings.TrimSpace(a.Time)
	switch {
	case a.Name == "":
		return a, errors.New("give the automation a name")
	case len([]rune(a.Name)) > maxAutomationName:
		return a, fmt.Errorf("the name must be %d characters or fewer", maxAutomationName)
	case a.ProjectID == "":
		return a, errors.New("choose a project")
	case a.Provider == "":
		return a, errors.New("choose a provider")
	case a.Task == "":
		return a, errors.New("write the task the agent should do")
	}
	if _, _, err := parseClock(a.Time); err != nil {
		return a, err
	}
	days, err := normaliseDays(a.Days)
	if err != nil {
		return a, err
	}
	a.Days = days
	return a, nil
}

// normaliseDays returns the weekdays sorted and without duplicates. Each must be 0 (Sunday) to 6 (Saturday).
func normaliseDays(days []int) ([]int, error) {
	if len(days) == 0 {
		return nil, errors.New("choose at least one day")
	}
	var seen [7]bool
	for _, d := range days {
		if d < 0 || d > 6 {
			return nil, fmt.Errorf("day %d is not a weekday from 0 (Sunday) to 6 (Saturday)", d)
		}
		seen[d] = true
	}
	out := []int{}
	for d, ok := range seen {
		if ok {
			out = append(out, d)
		}
	}
	return out, nil
}

// parseClock reads a 24-hour "HH:MM" time of day.
func parseClock(s string) (hour, minute int, err error) {
	t, err := time.Parse("15:04", s)
	if err != nil {
		return 0, 0, errors.New("the time must look like 15:04")
	}
	return t.Hour(), t.Minute(), nil
}

func runsOn(days []int, wd time.Weekday) bool {
	for _, d := range days {
		if d == int(wd) {
			return true
		}
	}
	return false
}

// slotOn is the given time of day on the calendar day of day, in day's location.
func slotOn(day time.Time, hh, mm int) time.Time {
	return time.Date(day.Year(), day.Month(), day.Day(), hh, mm, 0, 0, day.Location())
}

// latestSlot returns the most recent scheduled time at or before t.
func latestSlot(a model.Automation, t time.Time) (time.Time, bool) {
	hh, mm, err := parseClock(a.Time)
	if err != nil {
		return time.Time{}, false
	}
	// Today, then up to a week back: any non-empty set of weekdays recurs within seven days.
	for back := 0; back <= 7; back++ {
		slot := slotOn(t.AddDate(0, 0, -back), hh, mm)
		if !slot.After(t) && runsOn(a.Days, slot.Weekday()) {
			return slot, true
		}
	}
	return time.Time{}, false
}

// nextSlot returns the first scheduled time after t.
func nextSlot(a model.Automation, t time.Time) (time.Time, bool) {
	hh, mm, err := parseClock(a.Time)
	if err != nil {
		return time.Time{}, false
	}
	for ahead := 0; ahead <= 7; ahead++ {
		slot := slotOn(t.AddDate(0, 0, ahead), hh, mm)
		if slot.After(t) && runsOn(a.Days, slot.Weekday()) {
			return slot, true
		}
	}
	return time.Time{}, false
}

// ---- manager --------------------------------------------------------------------

// Automations returns every automation with its next scheduled run, oldest first.
func (m *Manager) Automations() []model.Automation {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.automationsLocked(time.Now())
}

func (m *Manager) automationsLocked(now time.Time) []model.Automation {
	out := make([]model.Automation, 0, len(m.automations))
	for _, a := range m.automations {
		c := *a
		c.Days = cloneOrEmpty(a.Days)
		c.NextRunAt = 0
		if c.Enabled {
			if next, ok := nextSlot(c, now); ok {
				c.NextRunAt = next.UnixMilli()
			}
		}
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt < out[j].CreatedAt })
	return out
}

// SaveAutomation creates an automation when a.ID is empty, and otherwise updates the one with that ID.
// Saving restarts the schedule from now, so an edit never fires a slot that has already passed.
func (m *Manager) SaveAutomation(a model.Automation) ([]model.Automation, error) {
	a, err := normaliseAutomation(a)
	if err != nil {
		return nil, err
	}
	prov, ok := m.providers[a.Provider]
	if !ok {
		return nil, fmt.Errorf("unknown provider %q", a.Provider)
	}
	if caps := prov.Capabilities(); a.Model != "" && len(caps.Models) > 0 && !caps.HasModel(a.Model) {
		return nil, fmt.Errorf("%s does not offer the model %q", prov.Name(), a.Model)
	}
	if a.PermissionMode != "" && !hasPermissionMode(prov.Capabilities().PermissionModes, a.PermissionMode) {
		return nil, fmt.Errorf("%s has no permission mode %q", prov.Name(), a.PermissionMode)
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.projects[a.ProjectID]; !ok {
		return nil, errors.New("choose a project first")
	}
	now := nowMs()
	if a.ID == "" {
		a.ID = newID()
		a.CreatedAt = now
	} else {
		prev, ok := m.automations[a.ID]
		if !ok {
			return nil, ErrAutomationNotFound
		}
		a.CreatedAt = prev.CreatedAt
	}
	a.LastRunAt = now
	a.LastError = ""
	m.automations[a.ID] = &a
	m.changedLocked()
	return m.automationsLocked(time.Now()), nil
}

// DeleteAutomation removes an automation. Agents it already launched are kept.
func (m *Manager) DeleteAutomation(id string) ([]model.Automation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.automations[id]; !ok {
		return nil, ErrAutomationNotFound
	}
	delete(m.automations, id)
	m.changedLocked()
	return m.automationsLocked(time.Now()), nil
}

// RunAutomation launches the automation's agent now, outside its schedule. The schedule is not moved.
func (m *Manager) RunAutomation(id string) ([]model.Automation, error) {
	m.mu.Lock()
	a, ok := m.automations[id]
	if !ok {
		m.mu.Unlock()
		return nil, ErrAutomationNotFound
	}
	req := automationRequest(*a, time.Now())
	m.mu.Unlock()

	_, err := m.Launch(req)

	m.mu.Lock()
	defer m.mu.Unlock()
	if cur, ok := m.automations[id]; ok {
		cur.LastError = errorText(err)
		m.changedLocked()
	}
	return m.automationsLocked(time.Now()), err
}

// RunDueAutomations handles each enabled automation whose scheduled time has come and has not been
// handled yet, either by launching its agent or by skipping a slot that is too late. It returns how
// many slots it handled. Launch takes the lock itself, so the launches happen outside it.
func (m *Manager) RunDueAutomations(now time.Time) int {
	type due struct {
		id   string
		slot time.Time
		req  LaunchRequest
	}
	var todo []due
	handled := 0

	m.mu.Lock()
	for id, a := range m.automations {
		if !a.Enabled {
			continue
		}
		slot, ok := latestSlot(*a, now)
		if !ok || slot.UnixMilli() <= a.LastRunAt {
			continue
		}
		if now.Sub(slot) > automationGrace {
			// Too late to start. The slot is marked handled, so it is not tried again.
			a.LastRunAt = slot.UnixMilli()
			a.LastError = "Skipped: Orbit was not open at the scheduled time."
			m.changedLocked()
			handled++
			continue
		}
		todo = append(todo, due{id: id, slot: slot, req: automationRequest(*a, slot)})
	}
	m.mu.Unlock()

	for _, d := range todo {
		_, err := m.Launch(d.req)
		m.mu.Lock()
		if a, ok := m.automations[d.id]; ok {
			a.LastRunAt = d.slot.UnixMilli()
			a.LastError = errorText(err)
			m.changedLocked()
		}
		m.mu.Unlock()
		handled++
	}
	return handled
}

// automationRequest is the launch an automation run makes. The agent is named for its automation and slot.
func automationRequest(a model.Automation, slot time.Time) LaunchRequest {
	return LaunchRequest{
		ProjectID:      a.ProjectID,
		Name:           fmt.Sprintf("%s · %s", a.Name, slot.Format("Mon 2 Jan 15:04")),
		Provider:       a.Provider,
		Model:          a.Model,
		PermissionMode: a.PermissionMode,
		Task:           a.Task,
	}
}

func hasPermissionMode(modes []model.PermissionMode, id string) bool {
	for _, m := range modes {
		if m.ID == id {
			return true
		}
	}
	return false
}

func errorText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}
