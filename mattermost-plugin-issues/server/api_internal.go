// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

// internalAuthMiddleware authenticates requests from the AI service using
// a shared secret sent in the X-Internal-Secret header.
func (p *Plugin) internalAuthMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		secret := r.Header.Get("X-Internal-Secret")

		p.configLock.RLock()
		expected := p.config.AIServiceSecret
		p.configLock.RUnlock()

		if secret == "" || secret != expected {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- Internal handlers (reuse store, attribute to bot) ---

func (p *Plugin) handleInternalListProjects(w http.ResponseWriter, _ *http.Request) {
	projects, err := p.store.ListProjects()
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, projects)
}

func (p *Plugin) handleInternalListIssues(w http.ResponseWriter, r *http.Request) {
	projectID := mux.Vars(r)["id"]
	q := r.URL.Query()

	params := IssueFilterParams{
		Status:      q.Get("status"),
		Priority:    q.Get("priority"),
		AssigneeID:  q.Get("assignee_id"),
		CycleID:     q.Get("cycle_id"),
		SearchQuery: q.Get("q"),
	}

	issues, err := p.store.ListIssues(projectID, params)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, IssueListResponse{
		Issues:     issues,
		TotalCount: len(issues),
	})
}

func (p *Plugin) handleInternalGetIssue(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	issue, err := p.store.GetIssue(id)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, issue)
}

func (p *Plugin) handleInternalCreateIssue(w http.ResponseWriter, r *http.Request) {
	projectID := mux.Vars(r)["id"]

	var req CreateIssueRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	now := nowMillis()
	status := req.Status
	if status == "" {
		status = IssueStatusBacklog
	}
	priority := req.Priority
	if priority == "" {
		priority = IssuePriorityNone
	}
	labelIDs := req.LabelIDs
	if labelIDs == nil {
		labelIDs = []string{}
	}

	issue := &Issue{
		ID:            uuid.New().String(),
		ProjectID:     projectID,
		Title:         req.Title,
		Description:   req.Description,
		Status:        status,
		Priority:      priority,
		LabelIDs:      labelIDs,
		AssigneeID:    req.AssigneeID,
		CycleID:       req.CycleID,
		EstimateHours: req.EstimateHours,
		CreatedBy:     p.botUserID,
		CreatedAt:     now,
		UpdatedAt:     now,
	}

	if err := issue.IsValid(); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	created, err := p.store.CreateIssue(issue)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	p.broadcastIssue(wsEventIssueCreated, created)
	respondJSON(w, http.StatusCreated, created)
}

func (p *Plugin) handleInternalUpdateIssue(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	issue, err := p.store.GetIssue(id)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	var req UpdateIssueRequest
	if err := decodeJSON(r, &req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Title != nil {
		issue.Title = *req.Title
	}
	if req.Description != nil {
		issue.Description = *req.Description
	}
	if req.Status != nil {
		oldStatus := issue.Status
		issue.Status = *req.Status
		if !oldStatus.IsCompleted() && issue.Status.IsCompleted() {
			issue.CompletedAt = nowMillis()
		} else if oldStatus.IsCompleted() && !issue.Status.IsCompleted() {
			issue.CompletedAt = 0
		}
	}
	if req.Priority != nil {
		issue.Priority = *req.Priority
	}
	if req.LabelIDs != nil {
		issue.LabelIDs = req.LabelIDs
	}
	if req.AssigneeID != nil {
		issue.AssigneeID = *req.AssigneeID
	}
	if req.CycleID != nil {
		issue.CycleID = *req.CycleID
	}
	if req.EstimateHours != nil {
		issue.EstimateHours = *req.EstimateHours
	}
	if req.SortOrder != nil {
		issue.SortOrder = *req.SortOrder
	}

	issue.UpdatedAt = nowMillis()

	if err := issue.IsValid(); err != nil {
		respondError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := p.store.UpdateIssue(issue); err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	p.broadcastIssue(wsEventIssueUpdated, issue)
	respondJSON(w, http.StatusOK, issue)
}

func (p *Plugin) handleInternalListLabels(w http.ResponseWriter, r *http.Request) {
	projectID := mux.Vars(r)["id"]
	labels, err := p.store.ListLabels(projectID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, labels)
}

func (p *Plugin) handleInternalListCycles(w http.ResponseWriter, r *http.Request) {
	projectID := mux.Vars(r)["id"]
	cycles, err := p.store.ListCycles(projectID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, cycles)
}
