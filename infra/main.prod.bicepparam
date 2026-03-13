// ORAN Bicep parameters — production environment
// Usage:
//   az deployment group create \
//     --resource-group oran-prod-rg \
//     --template-file infra/main.bicep \
//     --parameters @infra/main.prod.bicepparam

using 'main.bicep'

param prefix = 'oran'
param environment = 'prod'
param location = 'westus2'
param appServiceSku = 'B1'
param pgAdminUser = 'oranadmin'

// Secrets — pass at deploy time or from Key Vault / pipeline variables:
//   --parameters pgAdminPassword=<value> nextAuthSecret=<value> internalApiKey=<value> azureMapsSasToken=<value>
