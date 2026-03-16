CREATE TABLE IF NOT EXISTS saved_collections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_saved_collections_user
  ON saved_collections(user_id);

CREATE TABLE IF NOT EXISTS saved_collection_services (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  collection_id UUID NOT NULL REFERENCES saved_collections(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  saved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(collection_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_collection_services_collection
  ON saved_collection_services(collection_id);

CREATE INDEX IF NOT EXISTS idx_saved_collection_services_service
  ON saved_collection_services(service_id);
