// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
)

func (p *Plugin) handleGetIssueByIdentifier(w http.ResponseWriter, r *http.Request) {
	identifier := mux.Vars(r)["identifier"]
	issue, err := p.store.GetIssueByIdentifier(identifier)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	if _, err := p.getProjectForRequest(r, issue.ProjectID); err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, issue)
}

func (p *Plugin) handleSearchAllIssues(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		respondJSON(w, http.StatusOK, []*Issue{})
		return
	}
	limitStr := r.URL.Query().Get("limit")
	limit := 5
	if limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	issues, err := p.store.SearchAllIssues(query, limit)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	filtered := make([]*Issue, 0, len(issues))
	for _, issue := range issues {
		if _, err := p.getProjectForRequest(r, issue.ProjectID); err == nil {
			filtered = append(filtered, issue)
		}
	}
	respondJSON(w, http.StatusOK, filtered)
}
