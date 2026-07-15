-- 0072_service_embeddings.sql
--
-- Embeddings are derived search artifacts, not authoritative service content.
-- Keeping vectors in a separate table prevents reindexing from advancing the
-- services.updated_at freshness clock or tripping authoritative regression
-- detection. The content digest binds every vector to its exact source text.

BEGIN;

DO $vector_required$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_extension
    WHERE extname = 'vector'
  ) THEN
    RAISE EXCEPTION '0072 requires the vector extension installed by 0026';
  END IF;
END
$vector_required$;

CREATE TABLE public.service_embeddings (
  service_id uuid PRIMARY KEY
    REFERENCES public.services(id) ON DELETE CASCADE,
  embedding vector(1024) NOT NULL,
  model text NOT NULL,
  content_sha256 text NOT NULL
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  source_updated_at timestamptz NOT NULL,
  embedded_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.service_embeddings IS
  'Derived semantic-search vectors. Authoritative service freshness clocks must never depend on this table.';
COMMENT ON COLUMN public.service_embeddings.content_sha256 IS
  'SHA-256 of the exact normalized service text supplied to the embedding model.';
COMMENT ON COLUMN public.service_embeddings.source_updated_at IS
  'Exact services.updated_at version used to build this vector. Queries must reject rows whose version no longer matches.';

-- Deliberately do not backfill services.embedding. Legacy vectors have no
-- trustworthy model/content/version binding and must be regenerated.

CREATE INDEX idx_service_embeddings_hnsw
  ON public.service_embeddings
  USING hnsw (embedding vector_cosine_ops);

ALTER TABLE public.service_embeddings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.service_embeddings FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.service_embeddings
  TO oran_backend_runtime;

COMMIT;
