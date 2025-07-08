/* Contact enrichment function that processes companies in batches of 5,
   finds additional contact information, and updates company status.
*/

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Database } from './../_shared/database.types.ts';
import { ZoomInfoAuthManager } from '../_shared/zoominfo-auth.ts';
import { getCompanyFromZoomInfo } from '../_shared/zoominfo-api.ts';
import { createLogger } from '../_shared/logger.ts';

const CONSTANTS = {
  BATCH_SIZE: 5,
  SLEEP_SECONDS: 15,
  QUEUE_NAME: "contact-enrichment"
} as const;

const logger = createLogger('find-contacts');

function getEnvVar(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

interface QueueMessage {
  id: number;
  msg_id: number;
  message: { company_id: string };
}

interface Company {
  id: string;
  name: string;
  email: string[] | null;
  phone: string[] | null;
  city: string | null;
  state: string | null;
  industry: string[] | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  group: string | null;
  website: string | null;
}

export async function dequeueElement(pgmq_public: SupabaseClient<Database, 'pgmq_public'>, n: number) {
    const { data: messages, error: readError } = await pgmq_public.rpc('read', {
        queue_name: CONSTANTS.QUEUE_NAME,
        sleep_seconds: CONSTANTS.SLEEP_SECONDS,
        n: n,
    });

    if (readError) {
        throw readError;
    }

    return { data: messages as QueueMessage[], error: readError };
}

async function deleteMessage(pgmq_public: SupabaseClient<Database, 'pgmq_public'>, message: QueueMessage) {
    const { error } = await pgmq_public.rpc('delete', {
        queue_name: CONSTANTS.QUEUE_NAME,
        message_id: message.msg_id,
    });
    if (error) {
        logger.error('Error deleting message', { error, messageId: message.msg_id });
        throw error;
    }
}

async function archiveMessage(pgmq_public: SupabaseClient<Database, 'pgmq_public'>, message: QueueMessage) {
    logger.info('Archiving message', { companyId: message.message.company_id, messageId: message.msg_id });
    const { error } = await pgmq_public.rpc('archive', {
        queue_name: CONSTANTS.QUEUE_NAME,
        message_id: message.msg_id,
    });
    if (error) {
        logger.error('Error archiving message', { error, messageId: message.msg_id });
        throw error;
    }
}

async function getCompanyById(supabase: SupabaseClient<Database>, companyId: string): Promise<Company | null> {
    const { data, error } = await supabase
        .from('companies')
        .select('*')
        .eq('id', companyId)
        .single();

    if (error) {
        logger.error('Error fetching company', { companyId, error });
        return null;
    }

    return data as Company;
}

async function updateCompanyStatus(supabase: SupabaseClient<Database>, companyId: string, status: string) {
    const { error } = await supabase
        .from('companies')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', companyId);

    if (error) {
        logger.error('Error updating company status', { companyId, status, error });
        throw error;
    }
}

async function enrichCompanyContacts(company: Company, authManager: ZoomInfoAuthManager, getCompanyFromZoomInfoFn = getCompanyFromZoomInfo): Promise<void> {
    logger.info('Enriching contacts for company', { companyId: company.id, companyName: company.name });
    
    try {
        const token = await authManager.getValidToken();
        
        // Search for company in ZoomInfo using available data
        const searchParams = {
            companyName: company.name,
            state: company.state || undefined,
            city: company.city || undefined
        };
        
        const zoomInfoResponse = await getCompanyFromZoomInfoFn(searchParams, token);
        
        logger.info('Successfully enriched contacts using ZoomInfo', { 
            companyId: company.id, 
            companyName: company.name,
            zoomInfoResults: zoomInfoResponse.totalResults
        });
    } catch (error) {
        logger.error('Error enriching contacts', { companyId: company.id, companyName: company.name, error });
        throw new Error(`Failed to enrich contacts for ${company.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function createSupabaseClients(url: string, key: string) {
  const clientConfig = {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  };

  return {
    supabase: createClient<Database>(url, key, clientConfig),
    pgmq_public: createClient<Database, 'pgmq_public'>(url, key, {
      db: { schema: "pgmq_public" },
      ...clientConfig
    })
  };
}

async function processCompanies(messages: QueueMessage[], supabase: SupabaseClient<Database>, pgmq_public: SupabaseClient<Database, 'pgmq_public'>, authManager: ZoomInfoAuthManager, getCompanyFromZoomInfoFn = getCompanyFromZoomInfo) {
    // Process each company independently using Promise.allSettled
    const results = await Promise.allSettled(
        messages.map(async (message) => {
            const companyId = message.message.company_id;
            
            try {
                // Get company data
                const company = await getCompanyById(supabase, companyId);
                if (!company) {
                    throw new Error(`Company ${companyId} not found`);
                }

                // Perform contact enrichment
                await enrichCompanyContacts(company, authManager, getCompanyFromZoomInfoFn);

                // Update status to pending on success
                await updateCompanyStatus(supabase, companyId, 'pending');
                
                // Delete message from queue
                await deleteMessage(pgmq_public, message);
                
                logger.info('Successfully processed company', { companyId, companyName: company.name });
                return { success: true, companyId, companyName: company.name };
                
            } catch (error) {
                logger.error('Error processing company', { companyId, error });
                
                try {
                    // Update status to contacts_failed on error
                    await updateCompanyStatus(supabase, companyId, 'contacts_failed');
                    
                    // Archive message
                    await archiveMessage(pgmq_public, message);
                    
                } catch (cleanupError) {
                    logger.error('Error during cleanup for company', { companyId, cleanupError });
                }
                
                return { success: false, companyId, error: error instanceof Error ? error.message : String(error) };
            }
        })
    );

    // Log results
    let successCount = 0;
    let failureCount = 0;
    
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            if (result.value.success) {
                successCount++;
                logger.info('Company processed successfully', { companyName: result.value.companyName });
            } else {
                failureCount++;
                logger.error('Company failed', { companyId: result.value.companyId, error: result.value.error });
            }
        } else {
            failureCount++;
            logger.error('Unexpected error processing message', { messageIndex: index, error: result.reason });
        }
    });

    logger.info('Batch processing complete', { successCount, failureCount });
}

export const handler = async (req: Request, overrides?: {
    dequeueElement?: typeof dequeueElement,
    getCompanyFromZoomInfo?: typeof getCompanyFromZoomInfo,
    supabaseClients?: {
        supabase: SupabaseClient<Database>,
        pgmq_public: SupabaseClient<Database, 'pgmq_public'>
    },
    authManager?: ZoomInfoAuthManager
}) => {
    let envVars;
    try {
      envVars = {
        SUPABASE_URL: getEnvVar('SUPABASE_URL'),
        SUPABASE_SERVICE_ROLE_KEY: getEnvVar('SUPABASE_SERVICE_ROLE_KEY')
      };
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    const { supabase, pgmq_public } = createSupabaseClients(
      envVars.SUPABASE_URL, 
      envVars.SUPABASE_SERVICE_ROLE_KEY
    );

    const clientConfig = {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    };

    const authManager = new ZoomInfoAuthManager(
      envVars.SUPABASE_URL,
      envVars.SUPABASE_SERVICE_ROLE_KEY,
      clientConfig
    );

    const dequeue = overrides?.dequeueElement ?? dequeueElement;
    const getCompanyFromZoomInfoFn = overrides?.getCompanyFromZoomInfo ?? getCompanyFromZoomInfo;

    try {
      const { data: messages } = await dequeue(pgmq_public, CONSTANTS.BATCH_SIZE);

      if (messages.length === 0) {
          return new Response(JSON.stringify({ 
              message: 'No new messages to process'
          }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
          });
      }

      logger.info('Processing companies for contact enrichment', { messageCount: messages.length });
      
      await processCompanies(messages, supabase, pgmq_public, authManager, getCompanyFromZoomInfoFn);

    } catch (error) {
      logger.error('Error in find-contacts handler', { error });
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify({ message: 'Contact enrichment processing complete' }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
};

if (typeof Deno === 'undefined' || !Deno.test) {
    // @ts-ignore: Deno.serve is available in the Supabase Edge Runtime
    Deno.serve(handler);
}
