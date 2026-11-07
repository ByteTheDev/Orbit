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
)

// ErrTalkBusy is returned when one of the agents is already running or in another talk.
var ErrTalkBusy = errors.New("one of these agents is busy or already in a talk")

// StartConversation makes agent aID open a talk with agent bID about topic. Each finished reply
// is passed to the other agent, which answers in turn, until maxReplies replies have been made,
// the talk is stopped, or a turn fails. Both agents keep their normal chat history.
func (m *Manager) StartConversation(aID, bID, topic string, maxReplies int) (model.Conversation, error) {
	topic = strings.TrimSpace(topic)
	if topic == "" {
		return model.Conversation{}, errors.New("say what the agents should talk about")
	}
	if maxReplies <= 0 {
		maxReplies = defaultConvReplies
	}
	if maxReplies > maxConvReplies {
		maxReplies = maxConvReplies
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	a, okA := m.agents[aID]
	b, okB := m.agents[bID]
	if !okA || !okB {
		return model.Conversation{}, ErrNotFound
	}
	if aID == bID || a.ProjectID != b.ProjectID {
		return model.Conversation{}, ErrOtherProject
	}
	if !m.capsLocked(a).Send || !m.capsLocked(b).Send {
		return model.Conversation{}, errors.New("both agents must accept messages to talk")
	}
	if a.Running || b.Running || m.inConversationLocked(aID) || m.inConversationLocked(bID) {
		return model.Conversation{}, ErrTalkBusy
	}

	prompt := fmt.Sprintf(
		"You are about to talk with %s (%s), another agent working on this same project.\n\nTopic: %s\n\nStart the conversation: share your view on the topic and ask %s what they think. Keep each reply focused. Your reply goes straight to them.",
		b.Name, m.providerNameLocked(b), topic, b.Name)
	if err := m.startTurnLocked(a, prompt, nil); err != nil {
		return model.Conversation{}, err
	}
	c := model.Conversation{
		ID: newID(), ProjectID: a.ProjectID, AgentAID: aID, AgentBID: bID,
		Topic: model.Truncate(topic, 240), Status: model.ConvActive, NextID: aID,
		MaxReplies: maxReplies, At: nowMs(),
	}
	m.conversations = append(m.conversations, c)
	m.trimConversationsLocked()
	m.dirtyProjects[a.ProjectID] = true
	m.scheduleFlushLocked()
	return c, nil
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
// talk, its reply is passed to the other agent. Otherwise it does nothing.
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
	if c.Replies >= c.MaxReplies {
		m.endConversationLocked(c, model.ConvDone, "")
		return
	}
	otherID := c.AgentAID
	if otherID == rec.ID {
		otherID = c.AgentBID
	}
	other, ok := m.agents[otherID]
	if !ok {
		m.endConversationLocked(c, model.ConvFailed, "the other agent was removed")
		return
	}
	if other.Running {
		m.endConversationLocked(c, model.ConvFailed, "the other agent was busy")
		return
	}
	prompt := fmt.Sprintf(
		"%s replied to you in a conversation.\nTopic: %s\n\n%s\n\nReply to them directly. This is reply %d of %d.",
		rec.Name, c.Topic, model.Truncate(r.reply, model.MaxTextBytes), c.Replies+1, c.MaxReplies)
	if err := m.startTurnLocked(other, prompt, nil); err != nil {
		m.endConversationLocked(c, model.ConvFailed, err.Error())
		return
	}
	c.NextID = otherID
	m.dirtyProjects[c.ProjectID] = true
	m.scheduleFlushLocked()
}

// endConversationsOfLocked ends every active talk that includes agentID.
func (m *Manager) endConversationsOfLocked(agentID, reason string) {
	for i := range m.conversations {
		c := &m.conversations[i]
		if c.Status == model.ConvActive && (c.AgentAID == agentID || c.AgentBID == agentID) {
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
	for _, c := range m.conversations {
		if c.Status == model.ConvActive && (c.AgentAID == agentID || c.AgentBID == agentID) {
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

func (m *Manager) providerNameLocked(rec *model.AgentRecord) string {
	if prov, ok := m.providers[rec.Provider]; ok {
		return prov.Name()
	}
	return rec.Provider
}
