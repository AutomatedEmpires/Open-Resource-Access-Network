# ORAN Azure Dashboard Modernization Blueprint

This document defines how ORAN should unify and modernize its Azure dashboard, telemetry, recordkeeping, and enterprise tooling surface.

The goal is not just to add more charts. The goal is to create one Azure-native operating system for ORAN across:

- platform health
- seeker and host application telemetry
- governance and compliance visibility
- source, verification, and operational records
- investor and executive reporting
- future partner and mobile expansion

## Current State

ORAN already has a strong Azure-first base:

- Azure App Service for the web application
- Azure Functions for timers and operational workflows
- Application Insights and Log Analytics for observability
- Key Vault for secrets
- PostgreSQL Flexible Server for primary data
- Azure Cache for Redis, Azure Maps, Azure AI Translator, Azure Communication Services

This is enough to build a serious Azure-native control plane. What is missing is unification.

Right now the Azure story is distributed across:

- resource pages in Azure
- Application Insights and Log Analytics
- GitHub Actions evidence
- repo documentation
- isolated integration notes

That is usable, but it is not yet a clean enterprise dashboard model.

## Target Model

ORAN should use a layered Azure dashboard and records architecture.

### Layer 1: Azure Monitor Workbooks as the main operator dashboard

Azure Workbooks should become the main internal dashboard canvas.

Why:

- Microsoft recommends Workbooks as the richest built-in Azure Monitor reporting canvas.
- Workbooks can combine logs, metrics, Application Insights, Azure Resource Graph, Azure Resource Manager, Azure Data Explorer, Prometheus, resource health, and RBAC data.
- Workbooks are the strongest fit for one cross-resource ORAN operations view.

Recommended ORAN workbooks:

- Platform overview workbook
- Seeker experience workbook
- Verification and ingestion workbook
- Security and governance workbook
- Release and delivery workbook
- Partner and source health workbook

### Layer 2: Azure portal dashboards for executive single-pane summaries

Azure dashboards should be used for concise executive overviews.

Why:

- Microsoft positions Azure dashboards as the single-pane view for Azure infrastructure and services.
- They are lighter than Workbooks and better for at-a-glance summaries.

Recommended ORAN executive dashboard tiles:

- web app health
- function app health
- error rate
- latency
- deployment status
- review queue backlog
- ingestion run status
- App Insights availability tests
- Key Vault health and secret rotation watchpoints
- cost and budget tiles

### Layer 3: Grafana only where it adds real value

Use Grafana deliberately, not by default.

Microsoft guidance is clear:

- use Azure portal Dashboards with Grafana if you are mainly visualizing Azure-native data and want the easiest path
- use Azure Managed Grafana if you need broader sharing, external data sources, private networking, managed identity/service principal auth, audit usage logs, or deeper operational dashboarding

Recommended ORAN stance:

- start with Azure Monitor Workbooks as the primary dashboard layer
- use Azure portal Dashboards with Grafana for quick operational templates if useful
- introduce Azure Managed Grafana only if ORAN needs advanced dashboard sharing, external data sources, or a real NOC-style operations console

### Layer 4: Power BI or Microsoft Fabric for business and investor reporting

Power BI should be used for business-centric and long-horizon analytics.

Why:

- Microsoft explicitly positions Power BI for KPI, long-term trend analysis, combining multiple data sources, and mobile/web sharing.
- Azure Monitor and Log Analytics data can feed Power BI datasets.

Recommended ORAN Power BI or Fabric reporting domains:

- supply growth and verification coverage
- seeker demand and top request patterns
- trust score distributions over time
- partner/source quality trends
- operational SLA and backlog trends
- investor-facing traction dashboards

Recommended split:

- Power BI for reporting now
- Fabric later if ORAN wants a broader Microsoft analytics estate with lakehouse, semantic model, notebook, and enterprise data workflows

## One Azure Data Spine

Dashboard modernization only works if the data flow is clean.

ORAN should treat **Log Analytics** as the Azure-native operations spine for telemetry and resource diagnostics.

### Default destinations

1. Application telemetry:
   Application Insights

2. Resource logs and platform diagnostics:
   Diagnostic settings routed into Log Analytics

3. Inventory and governance metadata:
   Azure Resource Graph surfaced inside Workbooks

4. Long-term business reporting:
   Power BI datasets sourced from Log Analytics queries, exported operational tables, and curated app data

5. Archive and downstream integrations when needed:
   Storage account and/or Event Hubs via diagnostic settings

Microsoft guidance supports this pattern:

- resource logs are not collected until diagnostic settings are configured
- Log Analytics is the recommended default destination for correlation and alerting
- Power BI can consume Azure Monitor and Log Analytics outputs for longer-term reporting

## Recommended Azure-Native Dashboard Stack For ORAN

| Concern | Best-fit Microsoft tool | Why |
| --- | --- | --- |
| Operator diagnostics | Azure Monitor Workbooks | richest Azure-native multi-source diagnostic canvas |
| Executive single pane | Azure portal dashboards | concise leadership view across Azure services |
| Advanced ops / NOC | Azure Managed Grafana | only if ORAN needs deeper sharing, external sources, or standalone Grafana workflows |
| KPI and investor reporting | Power BI | strongest fit for business and long-horizon metrics |
| Broader enterprise analytics | Microsoft Fabric | future expansion when ORAN needs a larger analytical estate |
| Inventory and governance overlays | Azure Resource Graph | tenant and subscription-wide asset visibility inside Workbooks |
| Alerting and action automation | Azure Monitor alerts + Logic Apps | event-driven operational response |

## The ORAN Workbook Set

These are the specific Workbooks I recommend creating first.

### 1. ORAN Command Center

Purpose:

- one front-door workbook for core health and operating posture

Panels:

- app availability
- request volume
- failed requests and exceptions
- function execution failures
- deployment health
- current environment and release pointers
- open alerts
- resource health state
- budget and cost snapshots

Data sources:

- Application Insights
- Log Analytics
- Azure Resource Graph
- Azure resource health

### 2. Seeker Experience Workbook

Purpose:

- understand end-user experience quality without exposing PII

Panels:

- latency by route family
- error rate by feature area
- top search/chat pathways
- trust band distribution in surfaced results
- translation and TTS feature usage
- map usage and directory usage trends

Data sources:

- Application Insights
- app custom events
- Log Analytics

### 3. Verification and Ingestion Workbook

Purpose:

- unify ingestion, verification, and queue health

Panels:

- ingestion run volumes
- failed stages by function
- review queue backlog
- SLA breach counts
- source health by source family
- stale listing and reverification counts

Data sources:

- Function App logs
- Log Analytics
- PostgreSQL operational exports if added
- Azure Resource Graph for function and storage resource context

### 4. Governance and Security Workbook

Purpose:

- give security and operations one place to see governance posture

Panels:

- Key Vault access and secret-health logs
- deployment identity and OIDC deployment activity
- CodeQL and GitHub evidence links
- RBAC and critical role review summaries
- Azure Policy compliance status
- Defender for Cloud and Sentinel signals when adopted

Data sources:

- Log Analytics
- Azure Resource Graph
- Azure RBAC data source in Workbooks

### 5. Partnership and Source Quality Workbook

Purpose:

- treat upstream data quality as an operational asset

Panels:

- partner/source coverage
- freshness by source
- verification pass rate by source
- anomaly rates by source
- source suspension or quarantine flags

## Additional Microsoft And Azure Tools To Add

Yes, you can expand the Microsoft ecosystem around ORAN. The best additions depend on whether you want stronger operations, stronger governance, or stronger analytics.

### High-value additions now

#### Azure Monitor diagnostic settings everywhere important

Apply diagnostic settings consistently across:

- Web App
- Function App
- Key Vault
- PostgreSQL Flexible Server
- Redis
- Communication Services
- Azure Maps where available
- Grafana if adopted

Route default logs to Log Analytics.

Optional secondary routes:

- Storage account for archive
- Event Hubs for downstream streaming/integration

#### Azure Resource Graph-backed governance views

Use Resource Graph inside Workbooks to keep a live inventory of:

- production resources
- configuration drift
- tags and ownership gaps
- missing diagnostic settings
- region and SKU footprint
- resource groups and environments

#### Azure Monitor alerts plus Logic Apps

Use Azure Monitor alerts for detection and Logic Apps for action.

Recommended automations:

- incident summaries to email or Teams
- backlog threshold notifications
- secret rotation reminders
- failed deployment notifications
- high-error-rate escalation

#### Power BI as the enterprise record-and-report layer

Use Power BI for:

- board and investor reporting
- partner scorecards
- executive KPI packs
- monthly operational review packs

#### Azure Blob Storage for evidence and record archive

This is already marked as future in the repo and should move up in priority.

Use it for:

- verification evidence files
- operational exports
- partner/source snapshots
- workbook export artifacts
- governance records that do not belong in app telemetry

### Strong additions later

#### Azure Managed Grafana

Add only if ORAN needs:

- standalone advanced dashboarding
- cross-cloud or non-Azure sources
- private networking
- richer sharing model than Azure portal dashboards
- explicit audit logs for dashboard usage

#### Microsoft Sentinel

Add when ORAN wants a stronger SOC-style security layer.

Use it for:

- correlation of security events
- suspicious access patterns
- alert triage and incident handling
- integration with Defender for Cloud and Log Analytics

#### Microsoft Purview

Add when ORAN needs formal data catalog, lineage, or governance at higher scale.

Use it for:

- data map and lineage across operational and analytics stores
- governance classification
- stewardship and ownership tracking

#### Microsoft Fabric

Add when ORAN grows beyond dashboarding into a broader analytics estate.

Use it for:

- curated analytics pipelines
- semantic models
- lakehouse patterns
- investor and partner data products

## Recordkeeping Strategy

If you want to “keep records” in a Microsoft-native way, split records into the correct classes instead of storing everything in one system.

### Operational records

Store in:

- PostgreSQL for app-owned business records
- Blob Storage for evidence files and source artifacts
- Log Analytics for operational telemetry and resource diagnostics

### Governance and audit records

Store in:

- PostgreSQL audit tables where the app owns the workflow
- Log Analytics for Azure resource diagnostics and platform operations
- Blob Storage for durable exported audit bundles if needed

### Business and investor records

Store in:

- Power BI datasets and reports
- optionally Fabric later for broader reporting and curation

### Real-time or event-stream integrations

Use:

- Event Hubs if ORAN later needs downstream enterprise integrations or streaming analytics

## Recommended Modernization Sequence

### Phase 1: unify visibility

- standardize diagnostic settings
- make Log Analytics the default diagnostic sink
- build the ORAN Command Center workbook
- build the Verification and Ingestion workbook
- add Resource Graph inventory panels

### Phase 2: unify governance and reporting

- add Azure dashboard executive view
- add Power BI operational and investor scorecards
- add alerting + Logic Apps automations
- add Blob Storage evidence/archive path

### Phase 3: expand enterprise controls

- add Azure Policy posture dashboarding
- add Defender for Cloud and possibly Sentinel
- add Managed Grafana only if the operations model needs it
- evaluate Purview or Fabric if analytics and governance scope broadens

## Recommended Changes To ORAN Docs And Infra

### Docs

The repo should treat the Azure dashboard and records layer as first-class platform architecture.

Recommended updates after adopting this blueprint:

- `docs/platform/PLATFORM_AZURE.md`
- `docs/platform/INTEGRATIONS.md`
- `docs/EVIDENCE_DASHBOARD.md`
- `infra/README.md`

### Infra

If you want this implemented in code and infrastructure next, the first infra changes should likely be:

- Log Analytics routing and diagnostic settings coverage
- Azure Monitor Workbook deployment artifacts
- optional Azure dashboard ARM/Bicep exports
- Blob Storage for evidence/archive
- Logic Apps for operational automation

## Current Azure Context In This Environment

The Azure extension auth context in this workspace is currently **not signed in**, so I did not attempt live provisioning changes through Azure extension tooling.

I was still able to confirm the ORAN resource inventory through Azure resource data available to the environment, including:

- `oranhf57ir-prod-web`
- `oranhf57ir-prod-func`
- `oranhf57ir-prod-kv`
- `oranhf57ir-prod-pg`
- `oranhf57ir-prod-logs`
- `oranhf57ir-prod-insights`
- `oranhf57ir-prod-redis`
- `oranhf57ir-prod-maps`
- `DefaultWorkspace-e3d708a7-6264-451c-bd7e-670fecfbf4fa-WUS2`

If you want actual Azure changes next, sign in the Azure extension context first and then the modernization work can move from documentation into implementation.

## Bottom Line

The cleanest modernization path is:

- **Workbooks** for the main ORAN operator dashboard
- **Azure dashboards** for concise executive overviews
- **Log Analytics** as the operational telemetry spine
- **Resource Graph** for inventory and governance overlays
- **Power BI** for investor, partner, and KPI reporting
- **Blob Storage** for evidence and archive growth
- **Logic Apps** for operational automation
- **Managed Grafana**, **Sentinel**, **Purview**, or **Fabric** only when ORAN genuinely needs those higher-order capabilities

That gives ORAN a more unified Azure control plane, better records hygiene, and a more enterprise-grade Microsoft ecosystem without overcomplicating the platform too early.
