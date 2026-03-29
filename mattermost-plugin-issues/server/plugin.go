// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
)

// Plugin implements the Mattermost plugin interface.
type Plugin struct {
	plugin.MattermostPlugin

	configLock          sync.RWMutex
	config              *configuration
	router              *mux.Router
	store               Store
	conversationMonitor *ConversationMonitor
	botUserID           string
	oliAgentUserID      string
	aiClient            *AIClient
}

// OnActivate is called when the plugin is activated.
func (p *Plugin) OnActivate() error {
	p.store = NewKVStore(p.API)
	p.router = p.initRouter()

	botUserID, err := p.ensureBot()
	if err != nil {
		return err
	}
	p.botUserID = botUserID

	oliAgentUserID, oliErr := p.ensureOliAgent()
	if oliErr != nil {
		return fmt.Errorf("failed to create oli-agent bot: %w", oliErr)
	}
	p.oliAgentUserID = oliAgentUserID

	notifChannel, chErr := p.ensureNotificationChannel()
	if chErr != nil {
		return fmt.Errorf("failed to create notification channel: %w", chErr)
	}

	// Load configuration.
	var config configuration
	if err := p.API.LoadPluginConfiguration(&config); err != nil {
		return fmt.Errorf("failed to load configuration: %w", err)
	}
	p.configLock.Lock()
	p.config = &config
	p.configLock.Unlock()

	if config.isAIEnabled() {
		p.aiClient = NewAIClient(config.AIServiceURL)
		p.API.LogInfo("[ConversationMonitor] AI analysis enabled",
			"ai_service_url", config.AIServiceURL,
		)
	} else {
		p.API.LogInfo("[ConversationMonitor] AI analysis disabled (missing configuration)")
	}

	// Seed company info if not set.
	if info, _ := p.store.GetCompanyInfo(); info == nil {
		_ = p.store.SetCompanyInfo(&CompanyInfo{
			Company: CompanyDetails{
				Name:        "OLI",
				Mission:     "Build an AI-powered project management layer inside Mattermost that automatically tracks issues from team conversations.",
				Description: "OLI is a hackathon project by a team of 4 ITBA engineers. It adds an intelligent issue tracker plugin to Mattermost with an AI agent (Fiona) that listens to conversations and creates, updates, or deletes issues automatically.",
				TeamMembers: []string{"admin", "friend1", "friend2", "friend3"},
			},
			Repository: RepositoryDetails{
				URL:         "https://github.com/PascalOrdano18/amsterdam",
				Description: "Mattermost plugin with AI-powered issue tracking. Includes a Go plugin server, React webapp, and a Node.js AI service.",
				TechStack:   []string{"Go", "React", "TypeScript", "Node.js", "Express", "OpenAI GPT-4o-mini", "Mattermost Plugin API", "Docker"},
				MainBranch:  "master",
			},
			State: CurrentState{
				Summary: "MVP is functional. Fiona (AI agent) analyzes conversations across all channels and creates issues. The plugin UI displays issues in a right-hand sidebar with filtering, grouping, and real-time updates.",
				Phase:   "mvp",
			},
		})
	}

	p.conversationMonitor = NewConversationMonitor(p.API, p.botUserID, p.oliAgentUserID, notifChannel.Id, p.onConversationEnd)

	if err := p.API.RegisterCommand(getCommand()); err != nil {
		return err
	}

	p.API.LogInfo("[ConversationMonitor] plugin activated",
		"bot_user_id", p.botUserID,
		"notification_channel_id", notifChannel.Id,
	)

	return nil
}

// OnConfigurationChange is called when the plugin configuration is updated.
func (p *Plugin) OnConfigurationChange() error {
	var config configuration
	if err := p.API.LoadPluginConfiguration(&config); err != nil {
		return fmt.Errorf("failed to load configuration: %w", err)
	}

	p.configLock.Lock()
	p.config = &config
	p.configLock.Unlock()

	if config.isAIEnabled() {
		p.aiClient = NewAIClient(config.AIServiceURL)
	} else {
		p.aiClient = nil
	}

	return nil
}

// onConversationEnd is called by the ConversationMonitor when a conversation
// ends. It sends the transcript to the AI service for analysis in a goroutine.
func (p *Plugin) onConversationEnd(conv *conversationState, usernameCache map[string]string) {
	p.configLock.RLock()
	config := p.config
	client := p.aiClient
	p.configLock.RUnlock()

	if client == nil || config == nil || !config.isAIEnabled() {
		p.API.LogWarn("[ConversationMonitor] AI not enabled, skipping analysis",
			"client_nil", fmt.Sprintf("%t", client == nil),
			"config_nil", fmt.Sprintf("%t", config == nil),
		)
		return
	}

	p.API.LogInfo("[ConversationMonitor] onConversationEnd triggered",
		"channel_id", conv.channelID,
		"channel_type", string(conv.channelType),
		"channel_name", conv.channelName,
		"messages", fmt.Sprintf("%d", len(conv.messages)),
		"ai_service_url", config.AIServiceURL,
	)

	// Build participants list.
	participants := make([]ConversationParticipant, len(conv.memberIDs))
	for i, id := range conv.memberIDs {
		username := usernameCache[id]
		if username == "" {
			username = id
		}
		// Strip leading @ if present.
		if len(username) > 0 && username[0] == '@' {
			username = username[1:]
		}
		participants[i] = ConversationParticipant{
			UserID:   id,
			Username: username,
		}
	}

	// Build messages list.
	messages := make([]ConversationMessagePayload, len(conv.messages))
	for i, msg := range conv.messages {
		username := usernameCache[msg.UserID]
		if username == "" {
			username = msg.UserID
		}
		if len(username) > 0 && username[0] == '@' {
			username = username[1:]
		}
		messages[i] = ConversationMessagePayload{
			UserID:   msg.UserID,
			Username: username,
			Message:  msg.Message,
			Timestamp: msg.Timestamp,
		}
	}

	duration := conv.lastMsgAt.Sub(conv.startedAt)

	// Build the Mattermost site URL for callbacks.
	siteURL := "http://localhost:8065"
	if cfg := p.API.GetConfig(); cfg != nil && cfg.ServiceSettings.SiteURL != nil && *cfg.ServiceSettings.SiteURL != "" {
		siteURL = *cfg.ServiceSettings.SiteURL
	}
	callbackURL := siteURL + "/plugins/com.mattermost.issues"

	req := &AnalyzeRequest{
		Conversation: ConversationPayload{
			ChannelID:       conv.channelID,
			ChannelType:     string(conv.channelType),
			ChannelName:     conv.channelName,
			Participants:    participants,
			Messages:        messages,
			StartedAt:       conv.startedAt.Format(time.RFC3339),
			EndedAt:         conv.lastMsgAt.Format(time.RFC3339),
			DurationSeconds: int(duration.Seconds()),
		},
		CallbackURL:    callbackURL,
		InternalSecret: config.AIServiceSecret,
		OpenAIAPIKey:   config.OpenAIAPIKey,
	}

	notifChannelID := p.conversationMonitor.notificationChannelID

	go func() {
		p.API.LogInfo("[ConversationMonitor] sending conversation to AI service",
			"channel_id", conv.channelID,
			"channel_type", string(conv.channelType),
			"messages", fmt.Sprintf("%d", len(messages)),
			"callback_url", callbackURL,
			"ai_service_url", config.AIServiceURL,
			"has_secret", fmt.Sprintf("%t", config.AIServiceSecret != ""),
			"has_openai_key", fmt.Sprintf("%t", config.OpenAIAPIKey != ""),
		)

		// Log each message being sent
		for i, m := range messages {
			p.API.LogInfo("[ConversationMonitor] message payload",
				"index", fmt.Sprintf("%d", i),
				"username", m.Username,
				"message", m.Message,
			)
		}

		result, err := client.Analyze(req)
		if err != nil {
			p.API.LogError("[ConversationMonitor] AI analysis failed", "error", err.Error())
			return
		}

		p.API.LogInfo("[ConversationMonitor] AI analysis complete",
			"actions_taken", fmt.Sprintf("%d", result.ActionsTaken),
			"summary_length", fmt.Sprintf("%d", len(result.Summary)),
			"summary", result.Summary,
		)

		if result.Summary == "" && result.ActionsTaken == 0 {
			p.API.LogInfo("[ConversationMonitor] AI found no actionable items")
			return
		}

		// Build a concise summary message.
		label := "conversation"
		switch conv.channelType {
		case "D":
			label = "DM"
		case "G":
			label = "group chat"
		case "P":
			label = "private channel"
		case "O":
			if conv.channelName != "" {
				label = fmt.Sprintf("~%s", conv.channelName)
			} else {
				label = "channel"
			}
		}

		memberNames := make([]string, 0, len(conv.memberIDs))
		for _, id := range conv.memberIDs {
			if name := usernameCache[id]; name != "" {
				memberNames = append(memberNames, name)
			}
		}

		summary := fmt.Sprintf("Analyzed %s between %s — %s",
			label,
			strings.Join(memberNames, ", "),
			result.Summary,
		)

		// Build props with issue refs for rich rendering.
		props := map[string]interface{}{}
		oliData := map[string]interface{}{}
		if len(result.IssueRefs) > 0 {
			refs := make([]interface{}, len(result.IssueRefs))
			for i, r := range result.IssueRefs {
				refs[i] = r.ToMap()
			}
			oliData["issue_refs"] = refs
		}
		if len(oliData) > 0 {
			props["oli_data"] = oliData
		}

		post := &model.Post{
			UserId:    p.oliAgentUserID,
			ChannelId: notifChannelID,
			Message:   summary,
			Type:      "custom_oli_response",
			Props:     props,
		}
		if _, appErr := p.API.CreatePost(post); appErr != nil {
			p.API.LogError("[ConversationMonitor] failed to post action summary", "error", appErr.Error())
		} else {
			p.API.LogInfo("[ConversationMonitor] action summary posted to notification channel")
		}

		// Post action notification as a reply to the last conversation message.
		lastPostID := ""
		if len(conv.messages) > 0 {
			lastPostID = conv.messages[len(conv.messages)-1].PostID
		}
		p.postActionNotification(conv.channelID, lastPostID, result.IssueRefs)
	}()
}

// MessageHasBeenPosted is invoked after a message is posted. It feeds the
// post into the conversation monitor to track DM conversation lifecycles.
// If the message mentions @fiona, the conversation is flushed immediately.
// If the message mentions @oli or is a DM to the oli-agent bot, it triggers
// Oli's chat handler.
func (p *Plugin) MessageHasBeenPosted(_ *plugin.Context, post *model.Post) {
	// Skip messages from our own bots to avoid loops.
	if post.UserId == p.botUserID || post.UserId == p.oliAgentUserID {
		return
	}

	p.conversationMonitor.HandlePost(post)

	if containsFionaMention(post.Message) {
		p.conversationMonitor.FlushConversation(post.ChannelId)
	}

	// Handle @oli mentions.
	p.API.LogInfo("[Oli] checking mention", "message", post.Message, "contains_oli", fmt.Sprintf("%t", containsOliMention(post.Message)))
	if containsOliMention(post.Message) {
		p.handleOliChat(post, true)
		return
	}

	// Handle DMs to the oli-agent bot.
	channel, appErr := p.API.GetChannel(post.ChannelId)
	if appErr == nil && channel.Type == model.ChannelTypeDirect {
		members, membErr := p.API.GetChannelMembers(post.ChannelId, 0, 10)
		if membErr == nil {
			for _, m := range members {
				if m.UserId == p.oliAgentUserID {
					p.handleOliChat(post, false)
					return
				}
			}
		}
	}
}

func containsFionaMention(message string) bool {
	return strings.Contains(strings.ToLower(message), "@fiona")
}

func containsOliMention(message string) bool {
	lower := strings.ToLower(message)
	idx := strings.Index(lower, "@oli")
	if idx < 0 {
		return false
	}
	end := idx + 4
	if end < len(lower) {
		next := lower[end]
		if (next >= 'a' && next <= 'z') || (next >= '0' && next <= '9') || next == '_' || next == '-' {
			return false
		}
	}
	return true
}

// handleOliChat sends the user's question to the AI service and posts
// Oli's response back in the same channel/thread. When stripMention is true,
// it removes the @oli mention from the message; when false (DMs), it uses
// the full message as-is.
func (p *Plugin) handleOliChat(post *model.Post, stripMention bool) {
	p.configLock.RLock()
	config := p.config
	client := p.aiClient
	p.configLock.RUnlock()

	if client == nil || config == nil || !config.isAIEnabled() {
		return
	}

	message := post.Message
	if stripMention {
		// Strip @oli mention from the message to get the question.
		lower := strings.ToLower(message)
		if idx := strings.Index(lower, "@oli"); idx >= 0 {
			message = message[:idx] + message[idx+4:]
		}
	}
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}

	// Resolve username.
	username := post.UserId
	if user, appErr := p.API.GetUser(post.UserId); appErr == nil {
		username = user.Username
	}

	// Build callback URL.
	siteURL := "http://localhost:8065"
	if cfg := p.API.GetConfig(); cfg != nil && cfg.ServiceSettings.SiteURL != nil && *cfg.ServiceSettings.SiteURL != "" {
		siteURL = *cfg.ServiceSettings.SiteURL
	}
	callbackURL := siteURL + "/plugins/com.mattermost.issues"

	req := &ChatRequest{
		Message:        message,
		ChannelID:      post.ChannelId,
		Username:       username,
		CallbackURL:    callbackURL,
		InternalSecret: config.AIServiceSecret,
		OpenAIAPIKey:   config.OpenAIAPIKey,
	}

	oliUserID := p.oliAgentUserID
	channelID := post.ChannelId
	rootID := post.RootId
	if stripMention && rootID == "" && post.Id != "" {
		// If the mention is a top-level post in a channel, reply in a thread under it.
		// In DMs (!stripMention), reply directly without threading.
		rootID = post.Id
	}

	go func() {
		p.API.LogInfo("[Oli] handling question",
			"channel_id", channelID,
			"user", username,
			"message", message,
		)

		result, err := client.Chat(req)
		if err != nil {
			p.API.LogError("[Oli] chat failed", "error", err.Error())
			return
		}

		props := map[string]interface{}{}
		oliData := map[string]interface{}{}
		if len(result.CodeSnippets) > 0 {
			snippets := make([]interface{}, len(result.CodeSnippets))
			for i, s := range result.CodeSnippets {
				snippets[i] = s.ToMap()
			}
			oliData["code_snippets"] = snippets
		}
		if len(result.IssueRefs) > 0 {
			refs := make([]interface{}, len(result.IssueRefs))
			for i, r := range result.IssueRefs {
				refs[i] = r.ToMap()
			}
			oliData["issue_refs"] = refs
		}
		if len(oliData) > 0 {
			props["oli_data"] = oliData
		}

		replyPost := &model.Post{
			UserId:    oliUserID,
			ChannelId: channelID,
			RootId:    rootID,
			Message:   result.Text,
			Type:      "custom_oli_response",
			Props:     props,
		}
		if _, appErr := p.API.CreatePost(replyPost); appErr != nil {
			p.API.LogError("[Oli] failed to post response", "error", appErr.Error())
		}

		// Post action notification in the same thread.
		p.postActionNotification(channelID, rootID, result.IssueRefs)
	}()
}

// postActionNotification posts a concise action summary to the given channel.
// It filters issue_refs to only those with action = "created", "edited", or "deleted",
// then formats the message accordingly.
func (p *Plugin) postActionNotification(channelID string, rootID string, issueRefs []IssueRef) {
	var actionRefs []IssueRef
	for _, ref := range issueRefs {
		if ref.Action == "created" || ref.Action == "edited" || ref.Action == "deleted" {
			actionRefs = append(actionRefs, ref)
		}
	}

	if len(actionRefs) == 0 {
		return
	}

	var message string
	if len(actionRefs) == 1 {
		ref := actionRefs[0]
		message = fmt.Sprintf("@oli %s issue **%s** — %s", ref.Action, ref.Identifier, ref.Title)
	} else {
		message = fmt.Sprintf("@oli took %d actions:\n", len(actionRefs))
		for _, ref := range actionRefs {
			message += fmt.Sprintf("- %s **%s** — %s\n", ref.Action, ref.Identifier, ref.Title)
		}
	}

	post := &model.Post{
		UserId:    p.oliAgentUserID,
		ChannelId: channelID,
		RootId:    rootID,
		Message:   message,
	}
	if _, appErr := p.API.CreatePost(post); appErr != nil {
		p.API.LogError("[Oli] failed to post action notification",
			"channel_id", channelID,
			"error", appErr.Error(),
		)
	}
}

// ensureNotificationChannel finds or creates the "all-the-actions" channel.
func (p *Plugin) ensureNotificationChannel() (*model.Channel, error) {
	teams, appErr := p.API.GetTeams()
	if appErr != nil {
		return nil, fmt.Errorf("could not get teams: %s", appErr.Error())
	}
	if len(teams) == 0 {
		return nil, fmt.Errorf("no teams found")
	}
	teamID := teams[0].Id

	ch, appErr := p.API.GetChannelByName(teamID, "all-the-actions", false)
	if appErr == nil {
		return ch, nil
	}

	ch, appErr = p.API.CreateChannel(&model.Channel{
		TeamId:      teamID,
		Name:        "all-the-actions",
		DisplayName: "All The Actions",
		Type:        model.ChannelTypeOpen,
		Purpose:     "Activity feed: issues created, updated, and deleted by the AI agent.",
	})
	if appErr != nil {
		return nil, fmt.Errorf("could not create channel: %s", appErr.Error())
	}
	return ch, nil
}

// ensureBot finds or creates the "oli-bot" bot user.
func (p *Plugin) ensureBot() (string, error) {
	botUserID, err := p.API.EnsureBotUser(&model.Bot{
		Username:    "oli-bot",
		DisplayName: "Oli Bot",
		Description: "Posts conversation end notifications.",
	})
	if err != nil {
		return "", err
	}
	return botUserID, nil
}

// ensureOliAgent finds or creates the "oli" bot user.
func (p *Plugin) ensureOliAgent() (string, error) {
	botUserID, err := p.API.EnsureBotUser(&model.Bot{
		Username:    "oli",
		DisplayName: "Oli",
		Description: "AI team member — ask me about the codebase, issues, or company.",
	})
	if err != nil {
		return "", err
	}
	return botUserID, nil
}

// ServeHTTP routes incoming HTTP requests to the plugin's REST API.
func (p *Plugin) ServeHTTP(_ *plugin.Context, w http.ResponseWriter, r *http.Request) {
	p.router.ServeHTTP(w, r)
}
