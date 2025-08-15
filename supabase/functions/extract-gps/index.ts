import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import exifr from 'npm:exifr';
import { Database } from './../_shared/database.types.ts';
import { createLogger } from './../_shared/logger.ts';

function getEnvVar(key: string): string {
  const value = typeof Deno !== 'undefined' && Deno.env && Deno.env.get ? Deno.env.get(key) : undefined;
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

const logger = createLogger('extract-gps');

async function extractGpsFromImagePath(supabase: SupabaseClient<Database>, imagePath: string): Promise<{latitude: number, longitude: number} | null> {
  try {
    logger.debug('Extracting GPS from image path', { imagePath });

    const { data, error } = await supabase.storage
      .from("gh-vehicle-photos")
      .download(imagePath);

    if (error) {
      logger.error('Failed to download image from storage', { imagePath, error: error.message });
      throw new Error(`Failed to download image: ${error.message}`);
    }

    if (!data) {
      logger.error('No data returned from storage download', { imagePath });
      throw new Error('No image data found');
    }

    const file = new File([data], imagePath.split('/').pop() || 'image', { type: 'image/jpeg' });
    
    logger.debug('Starting GPS extraction from file', {
      filename: file.name,
      type: file.type,
      size: file.size
    });

    const gpsData = await exifr.gps(file);
    
    if (!gpsData || typeof gpsData.latitude !== 'number' || typeof gpsData.longitude !== 'number') {
      logger.debug('No GPS data found in image', { imagePath });
      return null;
    }

    const { latitude, longitude } = gpsData;
    
    logger.debug('GPS coordinates extracted successfully', {
      imagePath,
      latitude,
      longitude
    });

    return { latitude, longitude };

  } catch (error) {
    logger.logError(error as Error, `Failed to extract GPS data from ${imagePath}`);
    return null;
  }
}

export const handler = async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const { image_path } = await req.json();

    if (!image_path) {
      logger.warn('Missing image_path parameter');
      return new Response(JSON.stringify({ error: "image_path is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const SUPABASE_SERVICE_ROLE_KEY = getEnvVar("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_URL = getEnvVar("SUPABASE_URL");

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    logger.info('Processing GPS extraction request', { image_path });

    const gpsData = await extractGpsFromImagePath(supabase, image_path);

    if (!gpsData) {
      logger.debug('No GPS data found for image', { image_path });
      return new Response(JSON.stringify({ 
        latitude: null, 
        longitude: null 
      }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    logger.info('GPS extraction completed successfully', { 
      image_path,
      hasCoordinates: true
    });

    return new Response(JSON.stringify({
      latitude: gpsData.latitude,
      longitude: gpsData.longitude
    }), {
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Handler error', { errorMessage, stack: error instanceof Error ? error.stack : undefined });
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

if (typeof Deno === 'undefined' || !Deno.test) {
  Deno.serve(handler);
}
