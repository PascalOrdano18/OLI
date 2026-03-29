// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

// Store defines the persistence interface for the issues plugin.
// The KV store implementation is the default; a SQL implementation can be
// swapped in later for deployments that need more sophisticated querying.
type Store interface {
	// Company Info
	GetCompanyInfo() (*CompanyInfo, error)
	SetCompanyInfo(info *CompanyInfo) error

	// Projects
	CreateProject(project *Project) error
	GetProject(id string) (*Project, error)
	ListProjects() ([]*Project, error)
	UpdateProject(project *Project) error
	DeleteProject(id string) error

	// Issues
	CreateIssue(issue *Issue) (*Issue, error)
	GetIssue(id string) (*Issue, error)
	ListIssues(projectID string, params IssueFilterParams) ([]*Issue, error)
	UpdateIssue(issue *Issue) error
	DeleteIssue(id string) error
	GetIssueByIdentifier(identifier string) (*Issue, error)
	SearchAllIssues(query string, limit int) ([]*Issue, error)

	// Labels
	CreateLabel(label *IssueLabel) error
	GetLabel(id string) (*IssueLabel, error)
	ListLabels(projectID string) ([]*IssueLabel, error)
	UpdateLabel(label *IssueLabel) error
	DeleteLabel(id string) error

	// Cycles
	CreateCycle(cycle *Cycle) error
	GetCycle(id string) (*Cycle, error)
	ListCycles(projectID string) ([]*Cycle, error)
	UpdateCycle(cycle *Cycle) error
	DeleteCycle(id string) error
}
