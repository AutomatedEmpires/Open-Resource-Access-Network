# Azure Functions — Ingestion Agent

Serverless queue-driven functions for the ingestion pipeline.

## Architecture

```
Timer Trigger (scheduledCrawl) → ingestion-fetch queue
                                        ↓
                                  fetchPage function → ingestion-extract queue
                                                              ↓
                                                        extractService function → ingestion-verify queue
                                                                                        ↓
                                                                                  verifyCandidate function → ingestion-route queue
                                                                                                                    ↓
                                                                                                              routeToAdmin function
```

## Functions

| Function | Trigger | Queue In | Queue Out |
|----------|---------|----------|-----------|
| `scheduledCrawl` | Timer (daily `0 0 6 * * *`) | — | `ingestion-fetch` |
| `fetchPage` | Queue (`ingestion-fetch`) | `ingestion-fetch` | `ingestion-extract` |
| `extractService` | Queue (`ingestion-extract`) | `ingestion-extract` | `ingestion-verify` |
| `verifyCandidate` | Queue (`ingestion-verify`) | `ingestion-verify` | `ingestion-route` |
| `routeToAdmin` | Queue (`ingestion-route`) | `ingestion-route` | — |
| `manualSubmit` | HTTP POST | — | `ingestion-fetch` |

## Status

These stubs define the function signatures, bindings, and integration points
with the existing `createIngestionService()` pipeline. They are ready to deploy
once Azure infrastructure (Storage Queues / Service Bus, Functions App) is provisioned.

## Deployment

```bash
# From project root, when Azure Functions Core Tools is installed:
cd functions
func start          # local testing
func azure functionapp publish <APP_NAME>
```

See `docs/PLATFORM_AZURE.md` for provisioning instructions.
