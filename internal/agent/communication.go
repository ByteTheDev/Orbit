// Package agent — communication between agents (models).
//
// Orbit already lets two agents in one project talk to each other (StartConversation)
// and hand work off (Delegate). This file exposes those capabilities under the names
// callers are most likely to reach for when they want two models — for example GPT
// and Claude — to work together on a single task, so the feature is discoverable
// regardless of which word a caller uses for it.
package agent

import (
	"orbit/internal/model"
)

// Communicate makes two agents in one project talk to each other about topic, passing
// each reply to the other, for up to maxReplies replies. It is the canonical entry
// point for "let these two models work together".
func (m *Manager) Communicate(aID, bID, topic string, maxReplies int) (model.Conversation, error) {
	return m.StartConversation(aID, bID, topic, maxReplies)
}

// StartCommunication is an alias for Communicate.
func (m *Manager) StartCommunication(aID, bID, topic string, maxReplies int) (model.Conversation, error) {
	return m.StartConversation(aID, bID, topic, maxReplies)
}

// Collaborate makes two agents work together on a shared task. The task becomes the
// topic of their conversation.
func (m *Manager) Collaborate(aID, bID, task string, maxReplies int) (model.Conversation, error) {
	if maxReplies <= 0 {
		maxReplies = defaultConvReplies
	}
	return m.StartConversation(aID, bID, task, maxReplies)
}

// StartCollaboration is an alias for Collaborate.
func (m *Manager) StartCollaboration(aID, bID, task string, maxReplies int) (model.Conversation, error) {
	return m.Collaborate(aID, bID, task, maxReplies)
}

// WorkTogether is an alias for Collaborate.
func (m *Manager) WorkTogether(aID, bID, task string, maxReplies int) (model.Conversation, error) {
	return m.Collaborate(aID, bID, task, maxReplies)
}

// StartWorkTogether is an alias for Collaborate.
func (m *Manager) StartWorkTogether(aID, bID, task string, maxReplies int) (model.Conversation, error) {
	return m.Collaborate(aID, bID, task, maxReplies)
}

// Talk is an alias for StartConversation.
func (m *Manager) Talk(aID, bID, topic string, maxReplies int) (model.Conversation, error) {
	return m.StartConversation(aID, bID, topic, maxReplies)
}

// StartTalk is an alias for StartConversation.
func (m *Manager) StartTalk(aID, bID, topic string, maxReplies int) (model.Conversation, error) {
	return m.StartConversation(aID, bID, topic, maxReplies)
}

// Discuss is an alias for StartConversation.
func (m *Manager) Discuss(aID, bID, topic string, maxReplies int) (model.Conversation, error) {
	return m.StartConversation(aID, bID, topic, maxReplies)
}

// StartDiscussion is an alias for StartConversation.
func (m *Manager) StartDiscussion(aID, bID, topic string, maxReplies int) (model.Conversation, error) {
	return m.StartConversation(aID, bID, topic, maxReplies)
}

// Chat is an alias for StartConversation.
func (m *Manager) Chat(aID, bID, topic string, maxReplies int) (model.Conversation, error) {
	return m.StartConversation(aID, bID, topic, maxReplies)
}

// StartChat is an alias for StartConversation.
func (m *Manager) StartChat(aID, bID, topic string, maxReplies int) (model.Conversation, error) {
	return m.StartConversation(aID, bID, topic, maxReplies)
}

// Relay hands a message from one agent to another and asks the receiver to act on it.
// It records a handoff, just like Delegate, so the galaxy can draw the beam.
func (m *Manager) Relay(fromID, toID, message string) (model.Handoff, error) {
	return m.Delegate(fromID, toID, message)
}

// RelayMessage is an alias for Relay.
func (m *Manager) RelayMessage(fromID, toID, message string) (model.Handoff, error) {
	return m.Delegate(fromID, toID, message)
}

// SendToAgent sends a message from one agent to another and asks the receiver to act on it.
func (m *Manager) SendToAgent(fromID, toID, message string) (model.Handoff, error) {
	return m.Delegate(fromID, toID, message)
}

// MessageAgent is an alias for SendToAgent.
func (m *Manager) MessageAgent(fromID, toID, message string) (model.Handoff, error) {
	return m.Delegate(fromID, toID, message)
}

// Tell is an alias for SendToAgent.
func (m *Manager) Tell(fromID, toID, message string) (model.Handoff, error) {
	return m.Delegate(fromID, toID, message)
}

// Ask is an alias for SendToAgent.
func (m *Manager) Ask(fromID, toID, question string) (model.Handoff, error) {
	return m.Delegate(fromID, toID, question)
}

// Handoff is an alias for Delegate.
func (m *Manager) Handoff(fromID, toID, task string) (model.Handoff, error) {
	return m.Delegate(fromID, toID, task)
}

// Assign is an alias for Delegate.
func (m *Manager) Assign(fromID, toID, task string) (model.Handoff, error) {
	return m.Delegate(fromID, toID, task)
}

// Request is an alias for Delegate.
func (m *Manager) Request(fromID, toID, task string) (model.Handoff, error) {
	return m.Delegate(fromID, toID, task)
}

// DelegateTask mirrors the App-level helper at the manager level.
func (m *Manager) DelegateTask(fromID, toID, task string) (model.Handoff, error) {
	return m.Delegate(fromID, toID, task)
}

// Task-oriented collaboration aliases. They reuse Collaborate and rely on the
// [[DONE]] completion marker so two models can keep working until the task is finished.
func (m *Manager) StartTaskConversation(aID, bID, task string, maxReplies int) (model.Conversation, error) {
	return m.Collaborate(aID, bID, task, maxReplies)
}

func (m *Manager) CollaborateToFinish(aID, bID, task string, maxReplies int) (model.Conversation, error) {
	return m.Collaborate(aID, bID, task, maxReplies)
}

func (m *Manager) WorkUntilDone(aID, bID, task string, maxReplies int) (model.Conversation, error) {
	return m.Collaborate(aID, bID, task, maxReplies)
}

func (m *Manager) FinishTogether(aID, bID, task string, maxReplies int) (model.Conversation, error) {
	return m.Collaborate(aID, bID, task, maxReplies)
}

func (m *Manager) StartCollaborationToFinish(aID, bID, task string, maxReplies int) (model.Conversation, error) {
	return m.Collaborate(aID, bID, task, maxReplies)
}