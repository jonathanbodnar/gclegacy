-- Initialize PostGIS extensions for the plantakeoff database
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS postgis_sfcgal;

-- Create indexes for better geometry performance
-- These will be applied after Prisma migrations create the tables

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE plantakeoff TO plantakeoff;
