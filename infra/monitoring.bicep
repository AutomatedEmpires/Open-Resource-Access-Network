// ORAN Monitoring — Azure Monitor Alert Rules
//
// Defines metric and log-based alerts for the ORAN platform.
// Deploy alongside main.bicep or as a separate deployment.
//
// Usage:
//   az deployment group create \
//     --resource-group <rg> \
//     --template-file infra/monitoring.bicep \
//     --parameters appInsightsId=<id> funcAppId=<id> webAppId=<id> actionGroupEmail=ops@example.com

targetScope = 'resourceGroup'

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

@description('Resource ID of the Application Insights instance')
param appInsightsId string

@description('Resource ID of the Web App')
param webAppId string

@description('Resource ID of the Function App')
param funcAppId string

@description('Email address for alert notifications')
param actionGroupEmail string

@description('Azure region')
param location string = resourceGroup().location

@description('Resource name prefix')
param prefix string = 'oran'

@description('Environment')
param environment string = 'prod'

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

var resourcePrefix = '${prefix}-${environment}'

// ---------------------------------------------------------------------------
// Action Group (email notifications)
// ---------------------------------------------------------------------------

resource actionGroup 'Microsoft.Insights/actionGroups@2023-09-01-preview' = {
  name: '${resourcePrefix}-ops-alerts'
  location: 'global'
  properties: {
    groupShortName: 'ORANOps'
    enabled: true
    emailReceivers: [
      {
        name: 'OpsTeam'
        emailAddress: actionGroupEmail
        useCommonAlertSchema: true
      }
    ]
  }
}

// ---------------------------------------------------------------------------
// Alert: Web App — High Server Error Rate (5xx > 5 in 5 min)
// ---------------------------------------------------------------------------

resource alertWebErrors 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${resourcePrefix}-web-5xx-errors'
  location: 'global'
  properties: {
    description: 'Fires when the web app returns more than 5 server errors (5xx) in a 5-minute window.'
    severity: 1
    enabled: true
    scopes: [webAppId]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'Http5xxCount'
          metricName: 'Http5xx'
          metricNamespace: 'Microsoft.Web/sites'
          operator: 'GreaterThan'
          threshold: 5
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [
      { actionGroupId: actionGroup.id }
    ]
  }
}

// ---------------------------------------------------------------------------
// Alert: Web App — High Response Time (avg > 10s in 5 min)
// ---------------------------------------------------------------------------

resource alertWebLatency 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${resourcePrefix}-web-high-latency'
  location: 'global'
  properties: {
    description: 'Fires when average response time exceeds 10 seconds over a 5-minute window.'
    severity: 2
    enabled: true
    scopes: [webAppId]
    evaluationFrequency: 'PT1M'
    windowSize: 'PT5M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'AvgResponseTime'
          metricName: 'HttpResponseTime'
          metricNamespace: 'Microsoft.Web/sites'
          operator: 'GreaterThan'
          threshold: 10
          timeAggregation: 'Average'
          criterionType: 'StaticThresholdCriterion'
        }
      ]
    }
    actions: [
      { actionGroupId: actionGroup.id }
    ]
  }
}

// ---------------------------------------------------------------------------
// Alert: Function App — Execution Failures (> 3 in 15 min)
// ---------------------------------------------------------------------------

resource alertFuncFailures 'Microsoft.Insights/metricAlerts@2018-03-01' = {
  name: '${resourcePrefix}-func-failures'
  location: 'global'
  properties: {
    description: 'Fires when Azure Functions have more than 3 execution failures in 15 minutes.'
    severity: 1
    enabled: true
    scopes: [funcAppId]
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    criteria: {
      'odata.type': 'Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria'
      allOf: [
        {
          name: 'FuncExecutionFailures'
          metricName: 'FunctionExecutionCount'
          metricNamespace: 'Microsoft.Web/sites'
          operator: 'GreaterThan'
          threshold: 3
          timeAggregation: 'Total'
          criterionType: 'StaticThresholdCriterion'
          dimensions: [
            {
              name: 'FunctionExecutionStatus'
              operator: 'Include'
              values: ['Failed']
            }
          ]
        }
      ]
    }
    actions: [
      { actionGroupId: actionGroup.id }
    ]
  }
}

// ---------------------------------------------------------------------------
// Alert: Log-based — SLA Breach Count (> 0 in 1 hour)
// ---------------------------------------------------------------------------

resource alertSlaBreaches 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: '${resourcePrefix}-sla-breaches'
  location: location
  properties: {
    description: 'Fires when any SLA breaches are detected by the hourly check.'
    displayName: 'ORAN SLA Breaches Detected'
    severity: 1
    enabled: true
    scopes: [appInsightsId]
    evaluationFrequency: 'PT1H'
    windowSize: 'PT1H'
    criteria: {
      allOf: [
        {
          query: '''
            traces
            | where message has "[checkSlaBreaches]" and message has "breached"
            | where timestamp > ago(1h)
            | summarize breachLogs = count()
          '''
          timeAggregation: 'Total'
          metricMeasureColumn: 'breachLogs'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [actionGroup.id]
    }
  }
}

// ---------------------------------------------------------------------------
// Alert: Log-based — Queue Backlog (ingestion queue depth > 50)
// ---------------------------------------------------------------------------

resource alertQueueBacklog 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: '${resourcePrefix}-queue-backlog'
  location: location
  properties: {
    description: 'Fires when ingestion queue processing falls behind (error rate spikes).'
    displayName: 'ORAN Ingestion Queue Backlog'
    severity: 2
    enabled: true
    scopes: [appInsightsId]
    evaluationFrequency: 'PT15M'
    windowSize: 'PT15M'
    criteria: {
      allOf: [
        {
          query: '''
            traces
            | where message has "[extractService]" or message has "[fetchPage]" or message has "[verifyCandidate]" or message has "[routeToAdmin]"
            | where message has "Failed" or message has "error" or message has "Error"
            | where timestamp > ago(15m)
            | summarize errorCount = count()
          '''
          timeAggregation: 'Total'
          metricMeasureColumn: 'errorCount'
          operator: 'GreaterThan'
          threshold: 10
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [actionGroup.id]
    }
  }
}

// ---------------------------------------------------------------------------
// Alert: Log-based — Coverage Gaps Detected
// ---------------------------------------------------------------------------

resource alertCoverageGaps 'Microsoft.Insights/scheduledQueryRules@2023-03-15-preview' = {
  name: '${resourcePrefix}-coverage-gaps'
  location: location
  properties: {
    description: 'Fires when coverage gap alerting detects unrouted candidates in areas with no admin coverage.'
    displayName: 'ORAN Coverage Gaps Detected'
    severity: 3
    enabled: true
    scopes: [appInsightsId]
    evaluationFrequency: 'P1D'
    windowSize: 'P1D'
    criteria: {
      allOf: [
        {
          query: '''
            traces
            | where message has "[alertCoverageGaps]" and message has "gap states"
            | where timestamp > ago(1d)
            | parse message with * "gap states, " alertsSent:int " alerts sent"
            | where alertsSent > 0
            | summarize totalAlerts = sum(alertsSent)
          '''
          timeAggregation: 'Total'
          metricMeasureColumn: 'totalAlerts'
          operator: 'GreaterThan'
          threshold: 0
          failingPeriods: {
            numberOfEvaluationPeriods: 1
            minFailingPeriodsToAlert: 1
          }
        }
      ]
    }
    actions: {
      actionGroups: [actionGroup.id]
    }
  }
}
