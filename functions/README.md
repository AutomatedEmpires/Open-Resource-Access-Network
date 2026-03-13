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

The repository now contains deployable Azure Functions packaging and a production deployment workflow.

Current maturity split:

- Runtime packaging and deployment path: implemented
- Trigger bindings and queue topology: implemented
- Business behavior inside some functions: still partially scaffolded and tied to the broader ingestion-service maturation path

Treat this directory as deployable runtime infrastructure with some still-evolving function behaviors, not as a purely hypothetical stub tree.

## Deployment

```bash
# From project root, when Azure Functions Core Tools is installed:
cd functions
func start          # local testing
func azure functionapp publish <APP_NAME>
```

See `docs/platform/PLATFORM_AZURE.md` for provisioning instructions.
