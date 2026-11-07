package agent

import (
	"errors"
	"fmt"
	"strings"

	"orbit/internal/model"
)

const (
	// maxConversations bounds the conversations kept in memory. Finished ones fall off first.
	maxConversations = 20
	// defaultConvReplies and maxConvReplies bound how many replies one talk may run for.
	defaultConvReplies = 8
	maxConvReplies     = 30
	// maxTeamMembers bounds how many agents one talk can include.
	maxTeamMembers = 6
)

// ErrTalkBusy is returned when one of the agents is already running or in another talk.
var ErrTalkBusy = errors.New("one of these agents is busy or already in a talk")

// StartConversation makes agent aID open a talk with agent bID about topic. Each finished reply
// is passed to the other agent, which answers in turn, until maxReplies replies have been made,
// the talk is stopped, or a turn fails. Both agents keep their normal chat history.
func (m *Manager) StartConversation(aID, bID, topic string, maxReplies int) (model.Conversation, error) {
	return m.StartTeam([]string{aID, bID}, topic, maxReplies)
}

// StartTeam makes the first agent open a talk about topic with the rest. Replies go round the
// members in order (first, second, …, last, first, …), each one passed to the next, until
// maxReplies replies have been made, the talk is stopped, or a turn fails.
func (m *Manager) StartTeam(memberIDs []string, topic string, maxReplies int) (model.Conversation, error) {
	topic = strings.TrimSpace(topic)
	if topic == "" {
		return model.Conversation{}, errors.New("say what the agents should talk about")
	}
	if len(memberIDs) < 2 {
		return model.Conversation{}, errors.New("a talk needs at least two agents")
	}
	if len(memberIDs) > maxTeamMembers {
		return model.Conversation{}, fmt.Errorf("a talk can include at most %d agents", maxTeamMembers)
	}
	if maxReplies <= 0 {
		maxReplies = defaultConvReplies
	}
	if maxReplies > maxConvReplies {
		maxReplies = maxConvReplies
	}
	m.mu.Lock()
	defer m.mu.Unlock()

	first, ok := m.agents[memberIDs[0]]
	if !ok {
		return model.Conversation{}, ErrNotFound
	}
	members := make([]model.AgentRecord, 0, len(memberIDs))
	seen := map[string]bool{}
	for _, id := range memberIDs {
		rec, ok := m.agents[id]
		if !ok {
			return model.Conversation{}, ErrNotFound
		}
		if seen[id] || rec.ProjectID != first.ProjectID {
			return model.Conversation{}, ErrOtherProject
		}
		seen[id] = true
		if !m.capsLocked(rec).Send {
			return model.Conversation{}, errors.New("every agent must accept messages to talk")
		}
		if rec.Running || m.inConversationLocked(id) {
			return model.Conversation{}, ErrTalkBusy
		}
		members = append(members, *rec)
	}

	var others []string
	for _, rec := range members[1:] {
		others = append(others, fmt.Sprintf("%s (%s)", rec.Name, m.providerNameLocked(&rec)))
	}
	prompt := fmt.Sprintf(
		"You are about to talk with %s, other agents working on this same project.\n\nTopic: %s\n\nStart the conversation: share your view on the topic and ask the others what they think. Keep each reply focused. When the task is finished, include [[DONE]] in your reply. Your reply goes to the next agent in turn.",
		strings.Join(others, ", "), topic)
	if err := m.startTurnLocked(first, prompt, nil); err != nil {
		return model.Conversation{}, err
	}
	c := model.Conversation{
		ID: newID(), ProjectID: first.ProjectID,
		AgentAID: memberIDs[0], AgentBID: memberIDs[1], Members: append([]string(nil), memberIDs...),
		Topic: model.Truncate(topic, 240), Status: model.ConvActive, NextID: first.ID,
		MaxReplies: maxReplies, At: nowMs(),
		Lines: []model.ConversationLine{{Name: "You", Text: model.Truncate(topic, 2000), At: nowMs()}},
	}
	m.conversations = append(m.conversations, c)
	m.trimConversationsLocked()
	m.dirtyProjects[first.ProjectID] = true
	m.scheduleFlushLocked()
	return c, nil
}

// LaunchTeam creates agents in one project and starts a talk among them about task. The first
// agent opens and the partners answer in turn. Every agent is created idle, so the talk can start
// straight away, and every partner works in the first agent's folder and branch. If a partner
// cannot be created, the agents before it are still there and the error says which.
func (m *Manager) LaunchTeam(first LaunchRequest, partners []LaunchRequest, task string, maxReplies int) (model.Conversation, error) {
	if strings.TrimSpace(task) == "" {
		return model.Conversation{}, errors.New("describe the shared task first")
	}
	if len(partners) == 0 {
		return model.Conversation{}, errors.New("add at least one agent to work with")
	}
	first.Task = ""
	a, err := m.Launch(first)
	if err != nil {
		return model.Conversation{}, err
	}
	ids := []string{a.ID}
	for _, p := range partners {
		p.Task = ""
		p.ProjectID = first.ProjectID
		p.Branch, p.NewBranch = "", false
		b, err := m.launch(p, a.ID)
		if err != nil {
			return model.Conversation{}, fmt.Errorf("%s was created, but a partner could not start: %w", a.Name, err)
		}
		ids = append(ids, b.ID)
	}
	return m.StartTeam(ids, task, maxReplies)
}

// LaunchPair creates two agents and starts a talk between them. It is LaunchTeam with one partner.
func (m *Manager) LaunchPair(first, partner LaunchRequest, task string, maxReplies int) (model.Conversation, error) {
	return m.LaunchTeam(first, []LaunchRequest{partner}, task, maxReplies)
}

// appendLineLocked adds a transcript line and drops the oldest once the cap is reached.
func appendLineLocked(c *model.Conversation, line model.ConversationLine) {
	c.Lines = append(c.Lines, line)
	if over := len(c.Lines) - model.MaxConversationLines; over > 0 {
		c.Lines = append([]model.ConversationLine(nil), c.Lines[over:]...)
	}
}

// StopConversation ends a talk. If an agent is replying, that turn is cancelled too.
func (m *Manager) StopConversation(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	c := m.convLocked(id)
	if c == nil || c.Status != model.ConvActive {
		return errors.New("this talk is already over")
	}
	m.endConversationLocked(c, model.ConvStopped, "Stopped")
	if r, ok := m.runs[c.NextID]; ok && !r.stopRequested {
		r.stopRequested = true
		r.cancel()
	}
	return nil
}

// advanceConversationLocked runs when agent rec's turn ends. If rec was the speaker in an active
// talk, its reply is passed to the next member. Otherwise it does nothing.
func (m *Manager) advanceConversationLocked(rec *model.AgentRecord, r *run) {
	c := m.speakingConvLocked(rec.ID)
	if c == nil {
		return
	}
	if r.stopRequested {
		m.endConversationLocked(c, model.ConvStopped, "Stopped")
		return
	}
	if !r.done || !r.success || r.reply == "" {
		msg := "the agent did not reply"
		if rec.LastError != "" {
			msg = rec.LastError
		}
		m.endConversationLocked(c, model.ConvFailed, msg)
		return
	}
	c.Replies++
	appendLineLocked(c, model.ConversationLine{
		AgentID:  rec.ID,
		Name:     rec.Name,
		Provider: rec.Provider,
		Text:     model.Truncate(strings.TrimSpace(strings.ReplaceAll(r.reply, "[[DONE]]", "")), 2000),
		At:       nowMs(),
	})
	if isConversationComplete(r.reply) {
		m.endConversationLocked(c, model.ConvDone, "")
		return
	}
	if c.Replies >= c.MaxReplies {
		m.endConversationLocked(c, model.ConvDone, "")
		return
	}
	nextID := nextMemberID(c, rec.ID)
	next, ok := m.agents[nextID]
	if !ok {
		m.endConversationLocked(c, model.ConvFailed, "the next agent was removed")
		return
	}
	if next.Running {
		m.endConversationLocked(c, model.ConvFailed, "the next agent was busy")
		return
	}
	prompt := fmt.Sprintf(
		"%s replied to you in a conversation.\nTopic: %s\n\n%s\n\nReply to them directly. When the task is finished, include [[DONE]] in your reply. This is reply %d of %d.",
		rec.Name, c.Topic, model.Truncate(r.reply, model.MaxTextBytes), c.Replies+1, c.MaxReplies)
	if err := m.startTurnLocked(next, prompt, nil); err != nil {
		m.endConversationLocked(c, model.ConvFailed, err.Error())
		return
	}
	c.NextID = nextID
	m.dirtyProjects[c.ProjectID] = true
	m.scheduleFlushLocked()
}

// nextMemberID returns the member who speaks after agentID, wrapping round to the first.
func nextMemberID(c *model.Conversation, agentID string) string {
	for i, id := range c.Members {
		if id == agentID {
			return c.Members[(i+1)%len(c.Members)]
		}
	}
	return ""
}

// conversationHasMember reports whether agentID takes part in the talk.
func conversationHasMember(c *model.Conversation, agentID string) bool {
	for _, id := range c.Members {
		if id == agentID {
			return true
		}
	}
	return false
}

// endConversationsOfLocked ends every active talk that includes agentID.
func (m *Manager) endConversationsOfLocked(agentID, reason string) {
	for i := range m.conversations {
		c := &m.conversations[i]
		if c.Status == model.ConvActive && conversationHasMember(c, agentID) {
			m.endConversationLocked(c, model.ConvStopped, reason)
		}
	}
}

func (m *Manager) endConversationLocked(c *model.Conversation, status, errText string) {
	c.Status = status
	c.Error = model.Truncate(errText, 240)
	c.DoneAt = nowMs()
	m.dirtyProjects[c.ProjectID] = true
	m.scheduleFlushLocked()
}

// convLocked returns a pointer into the conversation list, or nil. Only use it while holding mu,
// and do not hold it past an append to m.conversations.
func (m *Manager) convLocked(id string) *model.Conversation {
	for i := range m.conversations {
		if m.conversations[i].ID == id {
			return &m.conversations[i]
		}
	}
	return nil
}

// speakingConvLocked returns the active talk in which agentID is the one replying now.
func (m *Manager) speakingConvLocked(agentID string) *model.Conversation {
	for i := range m.conversations {
		c := &m.conversations[i]
		if c.Status == model.ConvActive && c.NextID == agentID {
			return c
		}
	}
	return nil
}

// inConversationLocked reports whether agentID is in an active talk.
func (m *Manager) inConversationLocked(agentID string) bool {
	for i := range m.conversations {
		c := &m.conversations[i]
		if c.Status == model.ConvActive && conversationHasMember(c, agentID) {
			return true
		}
	}
	return false
}

// trimConversationsLocked drops the oldest finished talks once the cap is reached. Active talks stay.
func (m *Manager) trimConversationsLocked() {
	for len(m.conversations) > maxConversations {
		idx := -1
		for i, c := range m.conversations {
			if c.Status != model.ConvActive {
				idx = i
				break
			}
		}
		if idx < 0 {
			return
		}
		m.conversations = append(m.conversations[:idx], m.conversations[idx+1:]...)
	}
}

// isConversationComplete reports whether a reply signals that the shared task is finished.
func isConversationComplete(reply string) bool {
	lower := strings.ToLower(reply)
	return strings.Contains(lower, "[[done]]") ||
		strings.Contains(lower, "task complete") ||
		strings.Contains(lower, "task is complete") ||
		strings.Contains(lower, "work is complete") ||
		strings.Contains(lower, "we are done")
}

func (m *Manager) providerNameLocked(rec *model.AgentRecord) string {
	if prov, ok := m.providers[rec.Provider]; ok {
		return prov.Name()
	}
	return rec.Provider
}
