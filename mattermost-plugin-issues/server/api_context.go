// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"net/http"

	"github.com/gorilla/mux"
)

// ProjectContext is a project with all its issues, labels, and cycles.
type ProjectContext struct {
	Project *Project      `json:"project"`
	Issues  []*Issue      `json:"issues"`
	Labels  []*IssueLabel `json:"labels"`
	Cycles  []*Cycle      `json:"cycles"`
}

// GeneralContext is the full state: company info plus all projects with their data.
type GeneralContext struct {
	Company  *CompanyInfo     `json:"company"`
	Projects []ProjectContext `json:"projects"`
}

// IssueContext is an issue enriched with resolved label, assignee, and cycle info.
type IssueContext struct {
	Issue        *Issue        `json:"issue"`
	Labels       []*IssueLabel `json:"labels"`
	AssigneeName string        `json:"assignee_name,omitempty"`
	CycleName    string        `json:"cycle_name,omitempty"`
}

func (p *Plugin) handleGetGeneralContext(w http.ResponseWriter, r *http.Request) {
	companyInfo, err := p.store.GetCompanyInfo()
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	projects, err := p.listProjectsForRequest(r)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	result := GeneralContext{Company: companyInfo, Projects: make([]ProjectContext, 0, len(projects))}
	totalIssues := 0
	openIssues := 0

	for _, project := range projects {
		issues, err := p.store.ListIssues(project.ID, IssueFilterParams{})
		if err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		labels, err := p.store.ListLabels(project.ID)
		if err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}
		cycles, err := p.store.ListCycles(project.ID)
		if err != nil {
			respondError(w, http.StatusInternalServerError, err.Error())
			return
		}

		for _, issue := range issues {
			totalIssues++
			if !issue.Status.IsCompleted() {
				openIssues++
			}
		}

		result.Projects = append(result.Projects, ProjectContext{Project: project, Issues: issues, Labels: labels, Cycles: cycles})
	}

	if result.Company != nil {
		result.Company.State.ActiveProjects = len(projects)
		result.Company.State.TotalIssues = totalIssues
		result.Company.State.OpenIssues = openIssues
	}

	respondJSON(w, http.StatusOK, result)
}

func (p *Plugin) handleGetProjectContext(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	project, err := p.getProjectForRequest(r, id)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	issues, err := p.store.ListIssues(id, IssueFilterParams{})
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	labels, err := p.store.ListLabels(id)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}
	cycles, err := p.store.ListCycles(id)
	if err != nil {
		respondError(w, http.StatusInternalServerError, err.Error())
		return
	}

	respondJSON(w, http.StatusOK, ProjectContext{Project: project, Issues: issues, Labels: labels, Cycles: cycles})
}

func (p *Plugin) handleGetIssueContext(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]

	issue, err := p.getIssueForRequest(r, id)
	if err != nil {
		respondError(w, http.StatusNotFound, err.Error())
		return
	}

	labels := make([]*IssueLabel, 0, len(issue.LabelIDs))
	for _, labelID := range issue.LabelIDs {
		if label, err := p.store.GetLabel(labelID); err == nil {
			labels = append(labels, label)
		}
	}

	var assigneeName string
	if issue.AssigneeID != "" {
		if user, appErr := p.API.GetUser(issue.AssigneeID); appErr == nil {
			assigneeName = user.Username
		}
	}

	var cycleName string
	if issue.CycleID != "" {
		if cycle, err := p.store.GetCycle(issue.CycleID); err == nil {
			cycleName = cycle.Name
		}
	}

	respondJSON(w, http.StatusOK, IssueContext{Issue: issue, Labels: labels, AssigneeName: assigneeName, CycleName: cycleName})
}
