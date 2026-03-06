// ORAN Infrastructure — Azure Bicep
//
// Provisions the complete ORAN platform:
//   - App Service Plan + Web App (Next.js)
//   - Azure Functions (Consumption) for ingestion pipeline
//   - Storage Account (queue triggers + function runtime)
//   - Key Vault (secrets)
//   - PostgreSQL Flexible Server + PostGIS
//   - Application Insights + Log Analytics
//   - Azure Communication Services (email notifications)
//   - Azure Cache for Redis (search caching)
//
// Usage:
//   az deployment group create \
//     --resource-group <rg> \
//     --template-file infra/main.bicep \
//     --parameters prefix=oran environment=prod location=westus2
//
// All secrets are stored in Key Vault. The web app and function app
// reference them via managed identity + Key Vault references.

targetScope = 'resourceGroup'

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

@description('Resource name prefix (e.g., oran)')
@minLength(2)
@maxLength(12)
param prefix string

@description('Environment name')
@allowed(['dev', 'staging', 'prod'])
param environment string

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('App Service plan SKU')
@allowed(['B1', 'B2', 'S1', 'P1v3'])
param appServiceSku string = 'B1'

@description('PostgreSQL admin username')
param pgAdminUser string = 'oranadmin'

@secure()
@description('PostgreSQL admin password')
param pgAdminPassword string

@secure()
@description('NextAuth.js session encryption secret')
param nextAuthSecret string

@secure()
@description('Internal API key for Functions → App communication')
param internalApiKey string

@description('Entra ID (Azure AD) client ID')
param entraClientId string = ''

@secure()
@description('Entra ID (Azure AD) client secret')
param entraClientSecret string = ''

@description('Entra ID (Azure AD) tenant ID')
param entraTenantId string = ''

@description('Sentry DSN (optional)')
param sentryDsn string = ''

@description('Custom hostname for the web app (optional)')
param customHostname string = ''

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

var resourcePrefix = '${prefix}-${environment}'
var webAppName = '${resourcePrefix}-web'
var funcAppName = '${resourcePrefix}-func'
var planName = '${resourcePrefix}-plan'
var funcPlanName = '${resourcePrefix}-func-plan'
var kvName = '${resourcePrefix}-kv'
var pgServerName = '${resourcePrefix}-pg'
var pgDbName = 'oran_db'
var storageName = replace('${prefix}${environment}st', '-', '')
var logWorkspaceName = '${resourcePrefix}-logs'
var appInsightsName = '${resourcePrefix}-insights'
var commName = '${resourcePrefix}-comm'
var redisName = '${resourcePrefix}-redis'

// ---------------------------------------------------------------------------
// Log Analytics Workspace
// ---------------------------------------------------------------------------

resource logWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logWorkspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

// ---------------------------------------------------------------------------
// Application Insights
// ---------------------------------------------------------------------------

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logWorkspace.id
    IngestionMode: 'LogAnalytics'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}

// ---------------------------------------------------------------------------
// Storage Account (Functions runtime + queue triggers)
// ---------------------------------------------------------------------------

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

// Create the ingestion queues
resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource queueFetch 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueService
  name: 'ingestion-fetch'
}

resource queueExtract 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueService
  name: 'ingestion-extract'
}

resource queueVerify 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueService
  name: 'ingestion-verify'
}

resource queueRoute 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-05-01' = {
  parent: queueService
  name: 'ingestion-route'
}

// ---------------------------------------------------------------------------
// Key Vault
// ---------------------------------------------------------------------------

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 7
  }
}

// Store secrets in Key Vault
resource secretDbUrl 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'database-url'
  properties: {
    value: 'postgresql://${pgAdminUser}:${pgAdminPassword}@${pgServer.properties.fullyQualifiedDomainName}:5432/${pgDbName}?sslmode=require'
  }
}

resource secretNextAuth 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'nextauth-secret'
  properties: {
    value: nextAuthSecret
  }
}

resource secretInternalApi 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'internal-api-key'
  properties: {
    value: internalApiKey
  }
}

resource secretEntraSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = if (!empty(entraClientSecret)) {
  parent: keyVault
  name: 'azure-ad-client-secret'
  properties: {
    value: entraClientSecret
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL Flexible Server
// ---------------------------------------------------------------------------

resource pgServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: pgServerName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: pgAdminUser
    administratorLoginPassword: pgAdminPassword
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }
}

resource pgDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: pgServer
  name: pgDbName
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// Enable PostGIS extension
resource pgPostGIS 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2023-12-01-preview' = {
  parent: pgServer
  name: 'azure.extensions'
  properties: {
    value: 'POSTGIS'
    source: 'user-override'
  }
}

// Allow Azure services to connect (required for App Service + Functions)
resource pgFirewallAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = {
  parent: pgServer
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// ---------------------------------------------------------------------------
// App Service Plan (Web App)
// ---------------------------------------------------------------------------

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  kind: 'linux'
  sku: {
    name: appServiceSku
  }
  properties: {
    reserved: true // Linux
  }
}

// ---------------------------------------------------------------------------
// Web App (Next.js)
// ---------------------------------------------------------------------------

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      alwaysOn: appServiceSku != 'B1' // B1 doesn't support Always On
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'NODE_ENV'; value: 'production' }
        { name: 'NEXT_TELEMETRY_DISABLED'; value: '1' }
        { name: 'DATABASE_URL'; value: '@Microsoft.KeyVault(SecretUri=${secretDbUrl.properties.secretUri})' }
        { name: 'NEXTAUTH_SECRET'; value: '@Microsoft.KeyVault(SecretUri=${secretNextAuth.properties.secretUri})' }
        { name: 'NEXTAUTH_URL'; value: !empty(customHostname) ? 'https://${customHostname}' : 'https://${webAppName}.azurewebsites.net' }
        { name: 'INTERNAL_API_KEY'; value: '@Microsoft.KeyVault(SecretUri=${secretInternalApi.properties.secretUri})' }
        { name: 'AZURE_AD_CLIENT_ID'; value: entraClientId }
        { name: 'AZURE_AD_CLIENT_SECRET'; value: !empty(entraClientSecret) ? '@Microsoft.KeyVault(SecretUri=${secretEntraSecret.properties.secretUri})' : '' }
        { name: 'AZURE_AD_TENANT_ID'; value: entraTenantId }
        { name: 'NEXT_PUBLIC_SENTRY_DSN'; value: sentryDsn }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'; value: appInsights.properties.ConnectionString }
      ]
    }
  }
}

// Grant Web App managed identity Key Vault Secrets User role
resource webAppKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, webApp.id, 'Key Vault Secrets User')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') // Key Vault Secrets User
    principalId: webApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Function App (Consumption Plan)
// ---------------------------------------------------------------------------

resource funcPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: funcPlanName
  location: location
  kind: 'functionapp'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true // Linux
  }
}

resource funcApp 'Microsoft.Web/sites@2023-12-01' = {
  name: funcAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: funcPlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20'
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      appSettings: [
        { name: 'AzureWebJobsStorage'; value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${az.environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}' }
        { name: 'FUNCTIONS_EXTENSION_VERSION'; value: '~4' }
        { name: 'FUNCTIONS_WORKER_RUNTIME'; value: 'node' }
        { name: 'WEBSITE_NODE_DEFAULT_VERSION'; value: '~20' }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'; value: appInsights.properties.ConnectionString }
        { name: 'ORAN_APP_URL'; value: 'https://${webApp.properties.defaultHostName}' }
        { name: 'INTERNAL_API_KEY'; value: '@Microsoft.KeyVault(SecretUri=${secretInternalApi.properties.secretUri})' }
      ]
    }
  }
}

// Grant Function App managed identity Key Vault Secrets User role
resource funcAppKvRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, funcApp.id, 'Key Vault Secrets User')
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') // Key Vault Secrets User
    principalId: funcApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// ---------------------------------------------------------------------------
// Azure Communication Services (email)
// ---------------------------------------------------------------------------

resource commService 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: commName
  location: 'global' // ACS is a global service
  properties: {
    dataLocation: 'United States'
  }
}

// ---------------------------------------------------------------------------
// Azure Cache for Redis
// ---------------------------------------------------------------------------

resource redis 'Microsoft.Cache/redis@2023-08-01' = {
  name: redisName
  location: location
  properties: {
    sku: {
      name: 'Basic'
      family: 'C'
      capacity: 0
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
    redisConfiguration: {
      'maxmemory-policy': 'allkeys-lru'
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

@description('Web App default hostname')
output webAppUrl string = 'https://${webApp.properties.defaultHostName}'

@description('Function App default hostname')
output funcAppUrl string = 'https://${funcApp.properties.defaultHostName}'

@description('Key Vault name')
output keyVaultName string = keyVault.name

@description('Application Insights connection string')
output appInsightsConnectionString string = appInsights.properties.ConnectionString

@description('Application Insights instrumentation key')
output appInsightsInstrumentationKey string = appInsights.properties.InstrumentationKey

@description('PostgreSQL server FQDN')
output pgServerFqdn string = pgServer.properties.fullyQualifiedDomainName

@description('Storage account name')
output storageAccountName string = storageAccount.name

@description('Redis hostname')
output redisHostname string = redis.properties.hostName

@description('Web App principal ID (for additional role assignments)')
output webAppPrincipalId string = webApp.identity.principalId

@description('Function App principal ID (for additional role assignments)')
output funcAppPrincipalId string = funcApp.identity.principalId
