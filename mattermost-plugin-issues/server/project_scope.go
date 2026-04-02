// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"fmt"
	"net/http"
	"strings"
)

const projectScopeHeader = "X-Oli-Team-Scope"

func normalizeProjectScope(scope string) string {
	return strings.TrimSpace(strings.ToLower(scope))
}

func projectScopeFromRequest(r *http.Request) string {
	if r == nil {
		return ""
	}
	return normalizeProjectScope(r.Header.Get(projectScopeHeader))
}

func projectMatchesScope(project *Project, scope string) bool {
	if project == nil {
		return false
	}
	if scope == "" {
		return true
	}
	return normalizeProjectScope(project.Scope) == scope
}

func scopeNotFoundError(entity, id string) error {
	return fmt.Errorf("%s not found: %s", entity, id)
}

func (p *Plugin) listProjectsForRequest(r *http.Request) ([]*Project, error) {
	projects, err := p.store.ListProjects()
	if err != nil {
		return nil, err
	}

	scope := projectScopeFromRequest(r)
	if scope == "" {
		return projects, nil
	}

	filtered := make([]*Project, 0, len(projects))
	for _, project := range projects {
		if projectMatchesScope(project, scope) {
			filtered = append(filtered, project)
		}
	}
	return filtered, nil
}

func (p *Plugin) getProjectForRequest(r *http.Request, id string) (*Project, error) {
	project, err := p.store.GetProject(id)
	if err != nil {
		return nil, err
	}
	if !projectMatchesScope(project, projectScopeFromRequest(r)) {
		return nil, scopeNotFoundError("project", id)
	}
	return project, nil
}

func (p *Plugin) getIssueForRequest(r *http.Request, id string) (*Issue, error) {
	issue, err := p.store.GetIssue(id)
	if err != nil {
		return nil, err
	}
	if _, err := p.getProjectForRequest(r, issue.ProjectID); err != nil {
		return nil, scopeNotFoundError("issue", id)
	}
	return issue, nil
}

func (p *Plugin) getLabelForRequest(r *http.Request, id string) (*IssueLabel, error) {
	label, err := p.store.GetLabel(id)
	if err != nil {
		return nil, err
	}
	if _, err := p.getProjectForRequest(r, label.ProjectID); err != nil {
		return nil, scopeNotFoundError("label", id)
	}
	return label, nil
}

func (p *Plugin) getCycleForRequest(r *http.Request, id string) (*Cycle, error) {
	cycle, err := p.store.GetCycle(id)
	if err != nil {
		return nil, err
	}
	if _, err := p.getProjectForRequest(r, cycle.ProjectID); err != nil {
		return nil, scopeNotFoundError("cycle", id)
	}
	return cycle, nil
}
