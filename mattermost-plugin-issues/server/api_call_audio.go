// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"
)

const maxAudioUploadSize = 50 << 20 // 50 MB

// handleCallAudioUpload receives audio from the Desktop App after a call ends,
// forwards it to the AI service for Whisper transcription and issue analysis,
// and posts the results to the notification channel.
func (p *Plugin) handleCallAudioUpload(w http.ResponseWriter, r *http.Request) {
	// Enforce size limit.
	r.Body = http.MaxBytesReader(w, r.Body, maxAudioUploadSize)

	if err := r.ParseMultipartForm(maxAudioUploadSize); err != nil {
		respondError(w, http.StatusBadRequest, "failed to parse multipart form: "+err.Error())
		return
	}

	// Read the audio file.
	file, _, err := r.FormFile("audio")
	if err != nil {
		respondError(w, http.StatusBadRequest, "missing audio file: "+err.Error())
		return
	}
	defer file.Close()

	audioData, err := io.ReadAll(file)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to read audio file: "+err.Error())
		return
	}

	channelID := r.FormValue("channel_id")
	if channelID == "" {
		respondError(w, http.StatusBadRequest, "missing channel_id")
		return
	}

	p.configLock.RLock()
	config := p.config
	client := p.aiClient
	p.configLock.RUnlock()

	if client == nil || config == nil || !config.isAIEnabled() {
		respondError(w, http.StatusServiceUnavailable, "AI analysis is not configured")
		return
	}

	// Get channel info.
	channel, appErr := p.API.GetChannel(channelID)
	if appErr != nil {
		respondError(w, http.StatusBadRequest, "invalid channel_id: "+appErr.Error())
		return
	}

	// Resolve participants.
	participants := p.resolveChannelParticipants(channel)

	// Build callback URL.
	siteURL := "http://localhost:8065"
	if cfg := p.API.GetConfig(); cfg != nil && cfg.ServiceSettings.SiteURL != nil && *cfg.ServiceSettings.SiteURL != "" {
		siteURL = *cfg.ServiceSettings.SiteURL
	}
	callbackURL := strings.TrimRight(siteURL, "/") + "/plugins/com.mattermost.issues"

	metadata := &TranscribeAndAnalyzeMetadata{
		ChannelID:      channelID,
		ChannelType:    string(channel.Type),
		ChannelName:    channel.DisplayName,
		Participants:   participants,
		CallbackURL:    callbackURL,
		InternalSecret: config.AIServiceSecret,
		OpenAIAPIKey:   config.OpenAIAPIKey,
	}

	notifChannelID := p.conversationMonitor.notificationChannelID

	// Process asynchronously so the Desktop App doesn't have to wait.
	go func() {
		p.API.LogInfo("[CallAudio] sending audio to AI service for transcription",
			"channel_id", channelID,
			"audio_size", fmt.Sprintf("%d", len(audioData)),
		)

		result, err := client.TranscribeAndAnalyze(audioData, metadata)
		if err != nil {
			p.API.LogError("[CallAudio] transcribe-and-analyze failed", "error", err.Error())
			return
		}

		if result.Summary == "" && result.ActionsTaken == 0 {
			p.API.LogInfo("[CallAudio] AI found no actionable items from call")
			return
		}

		summary := fmt.Sprintf("#### :phone: AI Call Analysis\n%s\n\n*Actions taken: %d*", result.Summary, result.ActionsTaken)
		post := &model.Post{
			UserId:    p.botUserID,
			ChannelId: notifChannelID,
			Message:   summary,
		}
		if _, appErr := p.API.CreatePost(post); appErr != nil {
			p.API.LogError("[CallAudio] failed to post AI call summary", "error", appErr.Error())
		}

		// Post action notification to the original channel where the call happened.
		p.postActionNotification(channelID, "", result.IssueRefs)
	}()

	respondJSON(w, http.StatusAccepted, map[string]string{"status": "processing"})
}

// resolveChannelParticipants fetches channel members and resolves their usernames.
func (p *Plugin) resolveChannelParticipants(channel *model.Channel) []ConversationParticipant {
	var memberIDs []string

	if channel.Type == model.ChannelTypeDirect {
		parts := strings.SplitN(channel.Name, "__", 2)
		if len(parts) == 2 {
			memberIDs = parts
		} else {
			memberIDs = []string{channel.Name}
		}
	} else {
		members, appErr := p.API.GetChannelMembers(channel.Id, 0, 200)
		if appErr != nil {
			return nil
		}
		memberIDs = make([]string, len(members))
		for i, m := range members {
			memberIDs[i] = m.UserId
		}
	}

	// Resolve usernames.
	usernameMap := make(map[string]string)
	if users, appErr := p.API.GetUsersByIds(memberIDs); appErr == nil {
		for _, u := range users {
			usernameMap[u.Id] = u.Username
		}
	}

	participants := make([]ConversationParticipant, 0, len(memberIDs))
	for _, id := range memberIDs {
		username := usernameMap[id]
		if username == "" {
			username = id
		}
		participants = append(participants, ConversationParticipant{
			UserID:   id,
			Username: username,
		})
	}

	return participants
}
