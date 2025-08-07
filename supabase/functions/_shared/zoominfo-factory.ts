import { ZoomInfoService, type IZoomInfoService } from './zoominfo-service.ts';

export type { IZoomInfoService };
import { MockZoomInfoService } from './zoominfo-mocks.ts';
import { ZoomInfoAuthManager } from './zoominfo-auth.ts';
import { createLogger } from './logger.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Database } from './database.types.ts';

const logger = createLogger('zoominfo-factory');

export function createZoomInfoService(
  supabaseUrl?: string,
  supabaseServiceRoleKey?: string
): IZoomInfoService {
  const environment = Deno.env.get("ENVIRONMENT");
  
  logger.debug('Creating ZoomInfo service', { environment });
  
  if (environment === "test") {
    logger.debug('Using mock ZoomInfo service for test environment');
    return new MockZoomInfoService();
  }
  
  logger.debug('Using real ZoomInfo service');
  
  // Use provided parameters or get from environment
  const url = supabaseUrl || Deno.env.get("SUPABASE_URL");
  const key = supabaseServiceRoleKey || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!url || !key) {
    throw new Error('Missing Supabase URL or Service Role Key for ZoomInfo auth');
  }
  
  const authManager = new ZoomInfoAuthManager(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const supabase = createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
  
  return new ZoomInfoService(authManager, supabase);
}