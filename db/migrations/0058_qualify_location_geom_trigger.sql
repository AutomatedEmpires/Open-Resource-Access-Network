-- Keep the location geometry trigger safe under restricted SECURITY DEFINER paths.

CREATE OR REPLACE FUNCTION public.sync_location_geom()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.geom := public.ST_SetSRID(
      public.ST_MakePoint(NEW.longitude, NEW.latitude),
      4326
    );
  END IF;
  RETURN NEW;
END;
$function$;
