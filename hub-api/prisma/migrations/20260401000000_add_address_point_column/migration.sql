-- PostGIS extension + Address.point column
CREATE EXTENSION IF NOT EXISTS postgis;
ALTER TABLE "Address" ADD COLUMN IF NOT EXISTS point geometry(Point, 4326);
CREATE INDEX IF NOT EXISTS idx_address_point ON "Address" USING GIST (point);
