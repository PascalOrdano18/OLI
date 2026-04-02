// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import "fmt"

var legacySeedProjects = map[string]string{
	"Plataforma de Pagos":     "PAGOS",
	"App Móvil":               "MOVIL",
	"Panel de Administración": "ADMIN",
	"Infraestructura":         "INFRA",
}

func (p *Plugin) cleanupSeedSampleData() {
	projects, err := p.store.ListProjects()
	if err != nil {
		p.API.LogError("[SeedCleanup] failed to list projects", "error", err.Error())
		return
	}

	var deletedProjects int
	var deletedIssues int
	var deletedLabels int
	var deletedCycles int

	for _, project := range projects {
		if !isLegacySeedProject(project) {
			continue
		}

		issues, err := p.store.ListIssues(project.ID, IssueFilterParams{})
		if err != nil {
			p.API.LogError("[SeedCleanup] failed to list issues", "project", project.Name, "error", err.Error())
			return
		}
		for _, issue := range issues {
			if err := p.store.DeleteIssue(issue.ID); err != nil {
				p.API.LogError("[SeedCleanup] failed to delete issue", "project", project.Name, "issue", issue.Title, "error", err.Error())
				return
			}
			deletedIssues++
		}

		labels, err := p.store.ListLabels(project.ID)
		if err != nil {
			p.API.LogError("[SeedCleanup] failed to list labels", "project", project.Name, "error", err.Error())
			return
		}
		for _, label := range labels {
			if err := p.store.DeleteLabel(label.ID); err != nil {
				p.API.LogError("[SeedCleanup] failed to delete label", "project", project.Name, "label", label.Name, "error", err.Error())
				return
			}
			deletedLabels++
		}

		cycles, err := p.store.ListCycles(project.ID)
		if err != nil {
			p.API.LogError("[SeedCleanup] failed to list cycles", "project", project.Name, "error", err.Error())
			return
		}
		for _, cycle := range cycles {
			if err := p.store.DeleteCycle(cycle.ID); err != nil {
				p.API.LogError("[SeedCleanup] failed to delete cycle", "project", project.Name, "cycle", cycle.Name, "error", err.Error())
				return
			}
			deletedCycles++
		}

		if err := p.store.DeleteProject(project.ID); err != nil {
			p.API.LogError("[SeedCleanup] failed to delete project", "project", project.Name, "error", err.Error())
			return
		}
		deletedProjects++
	}

	if deletedProjects == 0 {
		return
	}

	if err := p.clearLegacySeedCompanyInfo(); err != nil {
		p.API.LogError("[SeedCleanup] failed to clear company info", "error", err.Error())
		return
	}

	p.API.LogInfo("[SeedCleanup] removed legacy seed data",
		"projects", fmt.Sprintf("%d", deletedProjects),
		"issues", fmt.Sprintf("%d", deletedIssues),
		"labels", fmt.Sprintf("%d", deletedLabels),
		"cycles", fmt.Sprintf("%d", deletedCycles),
	)
}

func isLegacySeedProject(project *Project) bool {
	prefix, ok := legacySeedProjects[project.Name]
	if !ok {
		return false
	}

	return project.Prefix == prefix && project.CreatedBy == "system"
}

func (p *Plugin) clearLegacySeedCompanyInfo() error {
	info, err := p.store.GetCompanyInfo()
	if err != nil {
		return err
	}
	if info == nil || info.Company.Name != "NovaPay" {
		return nil
	}

	return p.store.SetCompanyInfo(&CompanyInfo{})
}
