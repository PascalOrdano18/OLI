// Copyright (c) 2016-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

package main

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// seedSampleData populates the store with realistic sample data for a
// Latin-American fintech company. It is idempotent — if any projects already
// exist it returns immediately.
func (p *Plugin) seedSampleData() {
	existing, err := p.store.ListProjects()
	if err != nil {
		p.API.LogError("[Seed] failed to list projects", "error", err.Error())
		return
	}
	if len(existing) > 0 {
		return
	}

	p.API.LogInfo("[Seed] populating sample data …")

	now := time.Now()
	baseTime := now.Add(-30 * 24 * time.Hour).UnixMilli() // 30 days ago
	day := int64(24 * 60 * 60 * 1000)                     // 1 day in millis

	createdBy := "system"

	// ---------------------------------------------------------------
	// Projects
	// ---------------------------------------------------------------
	projects := []*Project{
		{ID: uuid.New().String(), Name: "Plataforma de Pagos", Prefix: "PAGOS", CreatedBy: createdBy, CreatedAt: baseTime},
		{ID: uuid.New().String(), Name: "App Móvil", Prefix: "MOVIL", CreatedBy: createdBy, CreatedAt: baseTime + day},
		{ID: uuid.New().String(), Name: "Panel de Administración", Prefix: "ADMIN", CreatedBy: createdBy, CreatedAt: baseTime + 2*day},
		{ID: uuid.New().String(), Name: "Infraestructura", Prefix: "INFRA", CreatedBy: createdBy, CreatedAt: baseTime + 3*day},
	}

	for _, proj := range projects {
		if err := p.store.CreateProject(proj); err != nil {
			p.API.LogError("[Seed] project", "name", proj.Name, "error", err.Error())
			return
		}
	}

	pPagos := projects[0].ID
	pMovil := projects[1].ID
	pAdmin := projects[2].ID
	pInfra := projects[3].ID

	// ---------------------------------------------------------------
	// Labels  (shared names, created per project)
	// ---------------------------------------------------------------
	type labelDef struct {
		Name  string
		Color string
	}
	sharedLabels := []labelDef{
		{"Bug", "#e05c5c"},
		{"Mejora", "#3dc779"},
		{"Seguridad", "#e74c3c"},
		{"Rendimiento", "#f39c12"},
		{"UI/UX", "#9b59b6"},
		{"Documentación", "#3498db"},
		{"Deuda técnica", "#95a5a6"},
	}

	// labelMap[projectID][labelName] = labelID
	labelMap := map[string]map[string]string{}
	for _, proj := range projects {
		labelMap[proj.ID] = map[string]string{}
		for _, ld := range sharedLabels {
			label := &IssueLabel{
				ID:        uuid.New().String(),
				ProjectID: proj.ID,
				Name:      ld.Name,
				Color:     ld.Color,
			}
			if err := p.store.CreateLabel(label); err != nil {
				p.API.LogError("[Seed] label", "name", ld.Name, "project", proj.Name, "error", err.Error())
			}
			labelMap[proj.ID][ld.Name] = label.ID
		}
	}

	// ---------------------------------------------------------------
	// Cycles (sprints)
	// ---------------------------------------------------------------
	cycles := []*Cycle{
		{ID: uuid.New().String(), ProjectID: pPagos, Name: "Sprint 14 — Marzo", StartDate: "2026-03-02", EndDate: "2026-03-15", IsActive: false},
		{ID: uuid.New().String(), ProjectID: pPagos, Name: "Sprint 15 — Marzo", StartDate: "2026-03-16", EndDate: "2026-03-29", IsActive: true},
		{ID: uuid.New().String(), ProjectID: pMovil, Name: "Sprint 8 — Marzo", StartDate: "2026-03-02", EndDate: "2026-03-15", IsActive: false},
		{ID: uuid.New().String(), ProjectID: pMovil, Name: "Sprint 9 — Marzo", StartDate: "2026-03-16", EndDate: "2026-03-29", IsActive: true},
		{ID: uuid.New().String(), ProjectID: pAdmin, Name: "Sprint 5 — Marzo", StartDate: "2026-03-16", EndDate: "2026-03-29", IsActive: true},
		{ID: uuid.New().String(), ProjectID: pInfra, Name: "Q1 2026 — Infraestructura", StartDate: "2026-01-06", EndDate: "2026-03-31", IsActive: true},
	}

	cycleMap := map[string]string{} // name -> ID
	for _, c := range cycles {
		if err := p.store.CreateCycle(c); err != nil {
			p.API.LogError("[Seed] cycle", "name", c.Name, "error", err.Error())
		}
		cycleMap[c.Name] = c.ID
	}

	// ---------------------------------------------------------------
	// Team member user IDs (will be displayed as assignees)
	// ---------------------------------------------------------------
	members := []string{"martin.garcia", "lucia.fernandez", "santiago.lopez", "valentina.ruiz", "nicolas.martinez"}

	// Helpers
	lb := func(projID, name string) string { return labelMap[projID][name] }
	cy := func(name string) string { return cycleMap[name] }

	// ---------------------------------------------------------------
	// Issues — Plataforma de Pagos
	// ---------------------------------------------------------------
	pagosIssues := []*Issue{
		{
			ID: uuid.New().String(), ProjectID: pPagos,
			Title:       "Error de redondeo en conversión USD→ARS",
			Description: "Al procesar pagos internacionales, el monto final en ARS tiene diferencias de centavos respecto al tipo de cambio oficial del BCRA. Afecta a comercios con volumen alto.",
			Status:      IssueStatusInProgress, Priority: IssuePriorityUrgent,
			LabelIDs: []string{lb(pPagos, "Bug"), lb(pPagos, "Seguridad")},
			AssigneeID: members[0], CycleID: cy("Sprint 15 — Marzo"),
			EstimateHours: 8, CreatedBy: members[2],
			CreatedAt: baseTime + 20*day, UpdatedAt: baseTime + 28*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pPagos,
			Title:       "Implementar webhook de notificación de pago exitoso",
			Description: "Los comercios necesitan recibir un POST a su endpoint cuando un pago se acredita. Incluir firma HMAC-SHA256 para validación.",
			Status:      IssueStatusInReview, Priority: IssuePriorityHigh,
			LabelIDs: []string{lb(pPagos, "Mejora")},
			AssigneeID: members[1], CycleID: cy("Sprint 15 — Marzo"),
			EstimateHours: 13, CreatedBy: members[0],
			CreatedAt: baseTime + 18*day, UpdatedAt: baseTime + 27*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pPagos,
			Title:       "Agregar soporte para pagos con QR Interoperable",
			Description: "Integrar el estándar de QR interoperable de la Cámara de Pagos para permitir cobros desde cualquier billetera virtual.",
			Status:      IssueStatusTodo, Priority: IssuePriorityHigh,
			LabelIDs: []string{lb(pPagos, "Mejora")},
			AssigneeID: members[3], CycleID: cy("Sprint 15 — Marzo"),
			EstimateHours: 21, CreatedBy: members[0],
			CreatedAt: baseTime + 22*day, UpdatedAt: baseTime + 22*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pPagos,
			Title:       "Timeout en consulta de estado de transferencia SPEI",
			Description: "Las consultas al endpoint de SPEI tardan más de 30s en horario pico (14-16hs). Hay que implementar circuit breaker y cache de estados recientes.",
			Status:      IssueStatusInProgress, Priority: IssuePriorityHigh,
			LabelIDs: []string{lb(pPagos, "Bug"), lb(pPagos, "Rendimiento")},
			AssigneeID: members[4], CycleID: cy("Sprint 15 — Marzo"),
			EstimateHours: 5, CreatedBy: members[1],
			CreatedAt: baseTime + 25*day, UpdatedAt: baseTime + 29*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pPagos,
			Title:       "Migrar procesamiento de lotes a cola asíncrona",
			Description: "Actualmente los archivos de conciliación se procesan de forma síncrona. Mover a una cola SQS con workers independientes para escalar horizontalmente.",
			Status:      IssueStatusBacklog, Priority: IssuePriorityMedium,
			LabelIDs: []string{lb(pPagos, "Mejora"), lb(pPagos, "Rendimiento")},
			EstimateHours: 34, CreatedBy: members[0],
			CreatedAt: baseTime + 10*day, UpdatedAt: baseTime + 10*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pPagos,
			Title:       "Documentar API de conciliación v2",
			Description: "Crear documentación OpenAPI 3.0 para los nuevos endpoints de conciliación automática. Incluir ejemplos de request/response y códigos de error.",
			Status:      IssueStatusTodo, Priority: IssuePriorityLow,
			LabelIDs: []string{lb(pPagos, "Documentación")},
			AssigneeID: members[2], CycleID: cy("Sprint 15 — Marzo"),
			EstimateHours: 5, CreatedBy: members[1],
			CreatedAt: baseTime + 15*day, UpdatedAt: baseTime + 15*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pPagos,
			Title:       "Refactorizar módulo de validación de CBU/CVU",
			Description: "El código actual tiene lógica duplicada entre la validación de CBU bancario y CVU de fintech. Unificar en un solo validador con strategy pattern.",
			Status:      IssueStatusDone, Priority: IssuePriorityMedium,
			LabelIDs: []string{lb(pPagos, "Deuda técnica")},
			AssigneeID: members[0], CycleID: cy("Sprint 14 — Marzo"),
			EstimateHours: 8, CreatedBy: members[0],
			CreatedAt: baseTime + 5*day, UpdatedAt: baseTime + 14*day, CompletedAt: baseTime + 14*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pPagos,
			Title:       "Límite de transferencia no se actualiza al cambiar categoría de usuario",
			Description: "Cuando un usuario pasa de categoría Básica a Verificada, el límite diario de transferencia no se actualiza hasta el día siguiente. Debería ser inmediato.",
			Status:      IssueStatusDone, Priority: IssuePriorityHigh,
			LabelIDs: []string{lb(pPagos, "Bug")},
			AssigneeID: members[1], CycleID: cy("Sprint 14 — Marzo"),
			EstimateHours: 3, CreatedBy: members[3],
			CreatedAt: baseTime + 3*day, UpdatedAt: baseTime + 12*day, CompletedAt: baseTime + 12*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pPagos,
			Title:       "Implementar reintentos automáticos en pagos rechazados por saldo insuficiente",
			Description: "Permitir configurar hasta 3 reintentos automáticos con backoff exponencial cuando el emisor rechaza por saldo insuficiente temporario.",
			Status:      IssueStatusBacklog, Priority: IssuePriorityMedium,
			LabelIDs: []string{lb(pPagos, "Mejora")},
			EstimateHours: 13, CreatedBy: members[2],
			CreatedAt: baseTime + 8*day, UpdatedAt: baseTime + 8*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pPagos,
			Title:       "Auditoría de cumplimiento PCI DSS nivel 1",
			Description: "Preparar la documentación y evidencia necesaria para la auditoría anual PCI DSS. Coordinar con el equipo de seguridad para las pruebas de penetración.",
			Status:      IssueStatusCancelled, Priority: IssuePriorityMedium,
			LabelIDs: []string{lb(pPagos, "Seguridad"), lb(pPagos, "Documentación")},
			AssigneeID: members[4],
			EstimateHours: 40, CreatedBy: members[0],
			CreatedAt: baseTime + 2*day, UpdatedAt: baseTime + 20*day, CompletedAt: baseTime + 20*day,
		},
	}

	// ---------------------------------------------------------------
	// Issues — App Móvil
	// ---------------------------------------------------------------
	movilIssues := []*Issue{
		{
			ID: uuid.New().String(), ProjectID: pMovil,
			Title:       "La app crashea al escanear QR con cámara trasera en Samsung Galaxy A series",
			Description: "Múltiples reportes de crash en Samsung Galaxy A14/A34 al abrir el escáner de QR. El crash ocurre en la librería de cámara CameraX. Afecta al 12% de usuarios Android.",
			Status:      IssueStatusInProgress, Priority: IssuePriorityUrgent,
			LabelIDs: []string{lb(pMovil, "Bug")},
			AssigneeID: members[3], CycleID: cy("Sprint 9 — Marzo"),
			EstimateHours: 8, CreatedBy: members[1],
			CreatedAt: baseTime + 26*day, UpdatedAt: baseTime + 29*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pMovil,
			Title:       "Implementar autenticación biométrica (Face ID / huella)",
			Description: "Agregar opción de desbloqueo con biometría para acceder a la app y confirmar transferencias mayores a $50.000. Usar BiometricPrompt en Android y LocalAuthentication en iOS.",
			Status:      IssueStatusInReview, Priority: IssuePriorityHigh,
			LabelIDs: []string{lb(pMovil, "Mejora"), lb(pMovil, "Seguridad")},
			AssigneeID: members[4], CycleID: cy("Sprint 9 — Marzo"),
			EstimateHours: 21, CreatedBy: members[0],
			CreatedAt: baseTime + 16*day, UpdatedAt: baseTime + 28*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pMovil,
			Title:       "Pantalla de historial de movimientos no carga más de 50 registros",
			Description: "La paginación del historial se rompe después de la tercera página. El endpoint devuelve 200 OK pero con array vacío. Problema en el cálculo del offset.",
			Status:      IssueStatusTodo, Priority: IssuePriorityMedium,
			LabelIDs: []string{lb(pMovil, "Bug")},
			AssigneeID: members[1], CycleID: cy("Sprint 9 — Marzo"),
			EstimateHours: 3, CreatedBy: members[3],
			CreatedAt: baseTime + 24*day, UpdatedAt: baseTime + 24*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pMovil,
			Title:       "Rediseño de la pantalla de envío de dinero",
			Description: "Simplificar el flujo de envío de 5 pasos a 3. Agregar selector de contactos frecuentes, autocompletado de alias y confirmación con resumen visual.",
			Status:      IssueStatusInProgress, Priority: IssuePriorityMedium,
			LabelIDs: []string{lb(pMovil, "UI/UX"), lb(pMovil, "Mejora")},
			AssigneeID: members[3], CycleID: cy("Sprint 9 — Marzo"),
			EstimateHours: 13, CreatedBy: members[0],
			CreatedAt: baseTime + 19*day, UpdatedAt: baseTime + 27*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pMovil,
			Title:       "Modo oscuro no aplica en la pantalla de ajustes",
			Description: "La pantalla de configuración y ajustes de la cuenta mantiene el tema claro aunque el usuario tenga modo oscuro activado. Falta propagar el tema al componente SettingsScreen.",
			Status:      IssueStatusDone, Priority: IssuePriorityLow,
			LabelIDs: []string{lb(pMovil, "Bug"), lb(pMovil, "UI/UX")},
			AssigneeID: members[1], CycleID: cy("Sprint 8 — Marzo"),
			EstimateHours: 2, CreatedBy: members[4],
			CreatedAt: baseTime + 5*day, UpdatedAt: baseTime + 10*day, CompletedAt: baseTime + 10*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pMovil,
			Title:       "Agregar notificaciones push para pagos recibidos",
			Description: "Cuando un usuario recibe una transferencia, debe recibir una notificación push inmediata con el monto y el remitente. Integrar con Firebase Cloud Messaging y APNs.",
			Status:      IssueStatusDone, Priority: IssuePriorityHigh,
			LabelIDs: []string{lb(pMovil, "Mejora")},
			AssigneeID: members[4], CycleID: cy("Sprint 8 — Marzo"),
			EstimateHours: 8, CreatedBy: members[0],
			CreatedAt: baseTime + 2*day, UpdatedAt: baseTime + 13*day, CompletedAt: baseTime + 13*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pMovil,
			Title:       "Optimizar tiempo de carga inicial de la app",
			Description: "La app tarda 4.2s en promedio en cargar en dispositivos de gama media. Objetivo: bajar a menos de 2s. Lazy-load de módulos no críticos y precaching de datos del usuario.",
			Status:      IssueStatusBacklog, Priority: IssuePriorityMedium,
			LabelIDs: []string{lb(pMovil, "Rendimiento")},
			EstimateHours: 21, CreatedBy: members[0],
			CreatedAt: baseTime + 7*day, UpdatedAt: baseTime + 7*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pMovil,
			Title:       "Soporte para lectura de tarjetas NFC en Android",
			Description: "Permitir a los usuarios acercar su tarjeta física de débito al celular para vincularla automáticamente a la cuenta. Solo Android por ahora.",
			Status:      IssueStatusBacklog, Priority: IssuePriorityLow,
			LabelIDs: []string{lb(pMovil, "Mejora")},
			EstimateHours: 34, CreatedBy: members[2],
			CreatedAt: baseTime + 12*day, UpdatedAt: baseTime + 12*day,
		},
	}

	// ---------------------------------------------------------------
	// Issues — Panel de Administración
	// ---------------------------------------------------------------
	adminIssues := []*Issue{
		{
			ID: uuid.New().String(), ProjectID: pAdmin,
			Title:       "Dashboard de métricas de transacciones en tiempo real",
			Description: "Crear un dashboard con gráficos de volumen de transacciones, tasa de éxito/fallo, y monto total procesado. Actualización cada 30 segundos vía WebSocket.",
			Status:      IssueStatusInProgress, Priority: IssuePriorityHigh,
			LabelIDs: []string{lb(pAdmin, "Mejora"), lb(pAdmin, "UI/UX")},
			AssigneeID: members[2], CycleID: cy("Sprint 5 — Marzo"),
			EstimateHours: 21, CreatedBy: members[0],
			CreatedAt: baseTime + 17*day, UpdatedAt: baseTime + 28*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pAdmin,
			Title:       "Filtro de usuarios por estado KYC no funciona",
			Description: "Al filtrar usuarios por estado 'Verificación pendiente' el panel muestra todos los usuarios sin filtrar. El query param `kyc_status` no se envía al backend.",
			Status:      IssueStatusTodo, Priority: IssuePriorityMedium,
			LabelIDs: []string{lb(pAdmin, "Bug")},
			AssigneeID: members[2], CycleID: cy("Sprint 5 — Marzo"),
			EstimateHours: 3, CreatedBy: members[1],
			CreatedAt: baseTime + 23*day, UpdatedAt: baseTime + 23*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pAdmin,
			Title:       "Exportar reporte de transacciones a CSV/Excel",
			Description: "Los operadores necesitan exportar los resultados de búsqueda de transacciones a CSV o Excel. Incluir todos los campos visibles más el ID interno de la transacción.",
			Status:      IssueStatusTodo, Priority: IssuePriorityMedium,
			LabelIDs: []string{lb(pAdmin, "Mejora")},
			AssigneeID: members[1], CycleID: cy("Sprint 5 — Marzo"),
			EstimateHours: 5, CreatedBy: members[0],
			CreatedAt: baseTime + 20*day, UpdatedAt: baseTime + 20*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pAdmin,
			Title:       "Implementar roles y permisos granulares",
			Description: "Actualmente todos los admins tienen acceso total. Necesitamos 3 roles: Operador (solo lectura), Supervisor (lectura + acciones), Admin (todo). Usar RBAC con middleware de permisos.",
			Status:      IssueStatusBacklog, Priority: IssuePriorityHigh,
			LabelIDs: []string{lb(pAdmin, "Seguridad"), lb(pAdmin, "Mejora")},
			EstimateHours: 34, CreatedBy: members[0],
			CreatedAt: baseTime + 5*day, UpdatedAt: baseTime + 5*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pAdmin,
			Title:       "Vista detalle de comercio con historial de transacciones",
			Description: "Al hacer clic en un comercio, abrir una vista con sus datos, documentación KYB, volumen mensual y las últimas 100 transacciones con filtros por estado y fecha.",
			Status:      IssueStatusDone, Priority: IssuePriorityMedium,
			LabelIDs: []string{lb(pAdmin, "Mejora"), lb(pAdmin, "UI/UX")},
			AssigneeID: members[2], CycleID: cy("Sprint 5 — Marzo"),
			EstimateHours: 13, CreatedBy: members[0],
			CreatedAt: baseTime + 10*day, UpdatedAt: baseTime + 22*day, CompletedAt: baseTime + 22*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pAdmin,
			Title:       "Log de auditoría de acciones administrativas",
			Description: "Registrar todas las acciones que realizan los operadores: bloqueo de usuarios, reversión de transacciones, cambios de configuración. Incluir IP, timestamp y detalle del cambio.",
			Status:      IssueStatusBacklog, Priority: IssuePriorityHigh,
			LabelIDs: []string{lb(pAdmin, "Seguridad")},
			EstimateHours: 13, CreatedBy: members[4],
			CreatedAt: baseTime + 8*day, UpdatedAt: baseTime + 8*day,
		},
	}

	// ---------------------------------------------------------------
	// Issues — Infraestructura
	// ---------------------------------------------------------------
	infraIssues := []*Issue{
		{
			ID: uuid.New().String(), ProjectID: pInfra,
			Title:       "Migrar base de datos primaria a Aurora PostgreSQL",
			Description: "La instancia RDS actual se queda sin IOPS en horario pico. Migrar a Aurora con read replicas para separar cargas de lectura/escritura. Planificar ventana de mantenimiento de 2hs.",
			Status:      IssueStatusInProgress, Priority: IssuePriorityUrgent,
			LabelIDs: []string{lb(pInfra, "Mejora"), lb(pInfra, "Rendimiento")},
			AssigneeID: members[4], CycleID: cy("Q1 2026 — Infraestructura"),
			EstimateHours: 40, CreatedBy: members[0],
			CreatedAt: baseTime + 5*day, UpdatedAt: baseTime + 29*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pInfra,
			Title:       "Configurar alertas de Datadog para latencia de API",
			Description: "Crear alertas que disparen cuando el p95 de latencia supere 500ms o el p99 supere 2s. Notificar por Slack al canal #infra-alertas y por PagerDuty al on-call.",
			Status:      IssueStatusDone, Priority: IssuePriorityHigh,
			LabelIDs: []string{lb(pInfra, "Mejora")},
			AssigneeID: members[4], CycleID: cy("Q1 2026 — Infraestructura"),
			EstimateHours: 5, CreatedBy: members[4],
			CreatedAt: baseTime + 3*day, UpdatedAt: baseTime + 8*day, CompletedAt: baseTime + 8*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pInfra,
			Title:       "Automatizar rotación de secretos en AWS Secrets Manager",
			Description: "Las credenciales de base de datos y API keys de terceros se rotan manualmente. Configurar rotación automática cada 90 días con Lambda y notificación al equipo.",
			Status:      IssueStatusTodo, Priority: IssuePriorityHigh,
			LabelIDs: []string{lb(pInfra, "Seguridad")},
			AssigneeID: members[4], CycleID: cy("Q1 2026 — Infraestructura"),
			EstimateHours: 13, CreatedBy: members[0],
			CreatedAt: baseTime + 15*day, UpdatedAt: baseTime + 15*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pInfra,
			Title:       "Pipeline de CI/CD tarda 25 minutos — optimizar",
			Description: "El pipeline completo (lint + test + build + deploy a staging) tarda 25 min. Paralelizar etapas independientes, agregar cache de dependencias y usar runners más grandes.",
			Status:      IssueStatusInReview, Priority: IssuePriorityMedium,
			LabelIDs: []string{lb(pInfra, "Rendimiento"), lb(pInfra, "Deuda técnica")},
			AssigneeID: members[0], CycleID: cy("Q1 2026 — Infraestructura"),
			EstimateHours: 8, CreatedBy: members[4],
			CreatedAt: baseTime + 12*day, UpdatedAt: baseTime + 26*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pInfra,
			Title:       "Implementar disaster recovery con failover a us-west-2",
			Description: "Actualmente corremos solo en us-east-1. Configurar réplica en us-west-2 con Route 53 health checks y failover automático. RTO objetivo: 15 minutos, RPO: 5 minutos.",
			Status:      IssueStatusBacklog, Priority: IssuePriorityMedium,
			LabelIDs: []string{lb(pInfra, "Mejora"), lb(pInfra, "Seguridad")},
			EstimateHours: 55, CreatedBy: members[0],
			CreatedAt: baseTime + 1*day, UpdatedAt: baseTime + 1*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pInfra,
			Title:       "Actualizar Kubernetes de 1.27 a 1.29",
			Description: "El cluster EKS está en la versión 1.27 que sale de soporte en abril. Planificar upgrade a 1.29 con validación de compatibilidad de todos los charts de Helm.",
			Status:      IssueStatusTodo, Priority: IssuePriorityHigh,
			LabelIDs: []string{lb(pInfra, "Deuda técnica")},
			AssigneeID: members[0], CycleID: cy("Q1 2026 — Infraestructura"),
			EstimateHours: 13, CreatedBy: members[4],
			CreatedAt: baseTime + 18*day, UpdatedAt: baseTime + 18*day,
		},
		{
			ID: uuid.New().String(), ProjectID: pInfra,
			Title:       "Certificado TLS del dominio de sandbox venció",
			Description: "El certificado de sandbox.novapay.com.ar expiró el 25/03. Renovar y configurar auto-renovación con cert-manager y Let's Encrypt.",
			Status:      IssueStatusDone, Priority: IssuePriorityUrgent,
			LabelIDs: []string{lb(pInfra, "Bug"), lb(pInfra, "Seguridad")},
			AssigneeID: members[4], CycleID: cy("Q1 2026 — Infraestructura"),
			EstimateHours: 2, CreatedBy: members[1],
			CreatedAt: baseTime + 25*day, UpdatedAt: baseTime + 25*day, CompletedAt: baseTime + 25*day,
		},
	}

	// Create all issues.
	allIssues := [][]*Issue{pagosIssues, movilIssues, adminIssues, infraIssues}
	projectNames := []string{"Plataforma de Pagos", "App Móvil", "Panel de Administración", "Infraestructura"}
	totalCreated := 0
	for idx, batch := range allIssues {
		for _, issue := range batch {
			if _, err := p.store.CreateIssue(issue); err != nil {
				p.API.LogError("[Seed] issue", "title", issue.Title, "project", projectNames[idx], "error", err.Error())
			} else {
				totalCreated++
			}
		}
	}

	// ---------------------------------------------------------------
	// Update company info with Spanish content.
	// ---------------------------------------------------------------
	_ = p.store.SetCompanyInfo(&CompanyInfo{
		Company: CompanyDetails{
			Name:        "NovaPay",
			Mission:     "Democratizar el acceso a pagos digitales seguros y eficientes para comercios y usuarios en América Latina.",
			Description: "NovaPay es una fintech que ofrece una plataforma integral de procesamiento de pagos. Permite a comercios aceptar pagos con tarjeta, transferencia bancaria, QR y billeteras virtuales desde una sola integración. La app móvil permite a usuarios enviar y recibir dinero al instante.",
			TeamMembers: members,
		},
		Repository: RepositoryDetails{
			URL:         "https://github.com/novapay/platform",
			Description: "Monorepo de la plataforma NovaPay: API de pagos, app móvil, panel de administración e infraestructura.",
			TechStack:   []string{"Go", "React", "React Native", "TypeScript", "PostgreSQL", "Redis", "Kubernetes", "AWS", "Terraform", "Datadog"},
			MainBranch:  "main",
		},
		State: CurrentState{
			Summary:        "Plataforma en producción con +15.000 comercios activos. Foco actual en QR interoperable, mejoras de rendimiento y migración a Aurora.",
			Phase:          "growth",
			ActiveProjects: 4,
			TotalIssues:    int(totalCreated),
			OpenIssues:     int(totalCreated - 7), // rough: done + cancelled count
		},
	})

	p.API.LogInfo("[Seed] sample data created",
		"projects", fmt.Sprintf("%d", len(projects)),
		"issues", fmt.Sprintf("%d", totalCreated),
		"labels", fmt.Sprintf("%d", len(projects)*len(sharedLabels)),
		"cycles", fmt.Sprintf("%d", len(cycles)),
	)
}
