/* Contact enrichment function that processes companies in batches of 5,
   finds additional contact information, and updates company status.
*/

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Database } from './../_shared/database.types.ts';

const CONSTANTS = {
  BATCH_SIZE: 5,
  SLEEP_SECONDS: 15,
  QUEUE_NAME: "contact-enrichment"
} as const;

function getEnvVar(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

function log(message: string, ...args: unknown[]) {
  console.log(`[find-contacts] ${message}`, ...args);
}

interface QueueMessage {
  id: number;
  msg_id: number;
  message: { company_id: string };
}

interface Company {
  id: string;
  name: string;
  primary_email: string | null;
  email: string[] | null;
  primary_phone: string | null;
  phone: string[] | null;
  city: string | null;
  state: string | null;
  industry: string[] | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  group: string | null;
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
        log('Error deleting message:', error);
        throw error;
    }
}

async function archiveMessage(pgmq_public: SupabaseClient<Database, 'pgmq_public'>, message: QueueMessage) {
    log(`Archiving message for company_id: ${message.message.company_id}`);
    const { error } = await pgmq_public.rpc('archive', {
        queue_name: CONSTANTS.QUEUE_NAME,
        message_id: message.msg_id,
    });
    if (error) {
        log('Error archiving message:', error);
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
        log(`Error fetching company ${companyId}:`, error);
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
        log(`Error updating company ${companyId} status to ${status}:`, error);
        throw error;
    }
}

async function enrichCompanyContacts(company: Company): Promise<void> {
    // TODO: Implement actual contact enrichment logic
    // This is a placeholder for the actual contact enrichment service
    // For now, we'll simulate the process
    
    log(`Enriching contacts for company: ${company.name}`);
    
    // Simulate contact enrichment process
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // For demonstration, we'll randomly fail some companies to test error handling
    if (Math.random() > 0.8) {
        throw new Error(`No additional contacts found for ${company.name}`);
    }
    
    log(`Successfully enriched contacts for company: ${company.name}`);
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

async function processCompanies(messages: QueueMessage[], supabase: SupabaseClient<Database>, pgmq_public: SupabaseClient<Database, 'pgmq_public'>) {
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
                await enrichCompanyContacts(company);

                // Update status to pending on success
                await updateCompanyStatus(supabase, companyId, 'pending');
                
                // Delete message from queue
                await deleteMessage(pgmq_public, message);
                
                log(`Successfully processed company: ${company.name}`);
                return { success: true, companyId, companyName: company.name };
                
            } catch (error) {
                log(`Error processing company ${companyId}:`, error);
                
                try {
                    // Update status to contacts_failed on error
                    await updateCompanyStatus(supabase, companyId, 'contacts_failed');
                    
                    // Archive message
                    await archiveMessage(pgmq_public, message);
                    
                } catch (cleanupError) {
                    log(`Error during cleanup for company ${companyId}:`, cleanupError);
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
                log(`✓ Company ${result.value.companyName} processed successfully`);
            } else {
                failureCount++;
                log(`✗ Company ${result.value.companyId} failed: ${result.value.error}`);
            }
        } else {
            failureCount++;
            log(`✗ Unexpected error processing message ${index}:`, result.reason);
        }
    });

    log(`Batch processing complete: ${successCount} successes, ${failureCount} failures`);
}

export const handler = async (req: Request, overrides?: {
    dequeueElement?: typeof dequeueElement
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

    const dequeue = overrides?.dequeueElement ?? dequeueElement;

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

      log(`Processing ${messages.length} companies for contact enrichment`);
      
      await processCompanies(messages, supabase, pgmq_public);

    } catch (error) {
      log('Error in find-contacts handler:', error);
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
