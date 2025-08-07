import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Database } from './../_shared/database.types.ts';
import { createLogger } from './../_shared/logger.ts';
import { generateEmail, generateTextMessage, ContactInfo } from './../_shared/claude-api.ts';

const CONSTANTS = {
  BATCH_SIZE: 5,
  SLEEP_SECONDS: 15,
  QUEUE_NAME: "email-generation"
} as const;

const logger = createLogger('generate-message');

function getEnvVar(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

interface QueueMessage {
  id: number;
  msg_id: number;
  message: { contact_zoominfo_id: number };
}

interface EnrichedContact {
  id: string;
  name: string | null;
  first_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  zoominfo_id: number;
  company: {
    id: string;
    name: string;
    industry: string[] | null;
  };
  photoLocation: string;
}

interface MessageResult {
  subject?: string;
  body?: string;
  message?: string;
}

export async function dequeueContacts(pgmq_public: SupabaseClient<Database, 'pgmq_public'>, n: number) {
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

export async function getContactsWithCompanyData(supabase: SupabaseClient<Database>, zoomInfoIds: number[]): Promise<EnrichedContact[]> {
    logger.info('Fetching contacts with company data', { zoomInfoIds });
    
    const { data: contacts, error: contactsError } = await supabase
        .from('contacts')
        .select(`
            id,
            name,
            first_name,
            email,
            phone,
            title,
            zoominfo_id,
            company_id,
            companies!inner(
                id,
                name,
                industry
            )
        `)
        .in('zoominfo_id', zoomInfoIds);

    if (contactsError) {
        logger.error('Error fetching contacts with company data', { zoomInfoIds, error: contactsError });
        throw contactsError;
    }

    logger.info('Found contacts', { contactCount: contacts?.length || 0, zoomInfoIds });

    if (!contacts || contacts.length === 0) {
        logger.warn('No contacts found for ZoomInfo IDs', { zoomInfoIds });
        return [];
    }

    const enrichedContacts: EnrichedContact[] = [];
    
    for (const contact of contacts) {
        const { data: photos, error: photosError } = await supabase
            .from('vehicle-photos')
            .select('location')
            .eq('company_id', contact.company_id)
            .limit(1);

        if (photosError) {
            logger.error('Error fetching vehicle photos', { companyId: contact.company_id, error: photosError });
            throw photosError;
        }

        enrichedContacts.push({
            id: contact.id,
            name: contact.name,
            first_name: contact.first_name,
            email: contact.email,
            phone: contact.phone,
            title: contact.title,
            zoominfo_id: contact.zoominfo_id!,
            company: {
                id: contact.companies.id,
                name: contact.companies.name,
                industry: contact.companies.industry
            },
            photoLocation: photos?.[0]?.location || 'Unknown location'
        });
        
        logger.debug('Enriched contact', {
            contactId: contact.id,
            zoomInfoId: contact.zoominfo_id,
            hasEmail: !!contact.email,
            hasPhone: !!contact.phone,
            companyName: contact.companies.name
        });
    }
    
    logger.info('Successfully enriched contacts', { 
        totalContacts: enrichedContacts.length,
        zoomInfoIds 
    });
    
    return enrichedContacts;
}

export function validateContactInfo(contact: EnrichedContact): void {
    if (!contact.email && !contact.phone) {
        throw new Error(`Contact ${contact.name} has neither email nor phone number`);
    }
}

export async function createEmail(contact: EnrichedContact, overrides?: {
    generateEmail?: typeof generateEmail,
    generateTextMessage?: typeof generateTextMessage
}): Promise<MessageResult> {
    const apiKey = getEnvVar('ANTHROPIC_API_KEY');
    
    const contactInfo: ContactInfo = {
        name: contact.name,
        company_id: contact.company.id,
        firstName: contact.first_name,
        title: contact.title,
        companyName: contact.company.name,
        industry: contact.company.industry,
        photoLocation: contact.photoLocation
    };
    
    try {
        const supabaseUrl = getEnvVar('SUPABASE_URL');
        const supabaseKey = getEnvVar('SUPABASE_SERVICE_ROLE_KEY');
        
        const emailGenerator = overrides?.generateEmail || generateEmail;
        const result = await emailGenerator(contactInfo, apiKey, supabaseUrl, supabaseKey);
        return {
            subject: result.subject,
            body: result.body
        };
    } catch (error) {
        logger.error('Error generating email with Claude API', {
            contactId: contact.id,
            contactName: contact.name,
            error: {
                message: error instanceof Error ? error.message : String(error),
                name: error instanceof Error ? error.name : 'Unknown',
                stack: error instanceof Error ? error.stack : undefined
            }
        });
        throw error;
    }
}

export async function createTextMessage(contact: EnrichedContact, overrides?: {
    generateEmail?: typeof generateEmail,
    generateTextMessage?: typeof generateTextMessage
}): Promise<MessageResult> {
    const apiKey = getEnvVar('ANTHROPIC_API_KEY');
    
    const contactInfo: ContactInfo = {
        name: contact.name,
        firstName: contact.first_name,
        title: contact.title,
        companyName: contact.company.name,
        industry: contact.company.industry,
        photoLocation: contact.photoLocation
    };
    
    try {
        const supabaseUrl = getEnvVar('SUPABASE_URL');
        const supabaseKey = getEnvVar('SUPABASE_SERVICE_ROLE_KEY');
        
        const textGenerator = overrides?.generateTextMessage || generateTextMessage;
        const message = await textGenerator(contactInfo, apiKey, supabaseUrl, supabaseKey);
        return {
            message
        };
    } catch (error) {
        logger.error('Error generating text message with Claude API', {
            contactId: contact.id,
            contactName: contact.name,
            error: {
                message: error instanceof Error ? error.message : String(error),
                name: error instanceof Error ? error.name : 'Unknown',
                stack: error instanceof Error ? error.stack : undefined
            }
        });
        throw error;
    }
}

export async function updateContactStatus(supabase: SupabaseClient<Database>, contactId: string, status: string, messageData?: MessageResult) {
    const updateData: any = { 
        status, 
        updated_at: new Date().toISOString() 
    };

    if (messageData?.subject) updateData.email_subject = messageData.subject;
    if (messageData?.body) updateData.email_body = messageData.body;
    if (messageData?.message) updateData.text_message = messageData.message;

    const { error } = await supabase
        .from('contacts')
        .update(updateData)
        .eq('id', contactId);

    if (error) {
        logger.error('Error updating contact status', { contactId, status, error });
        throw error;
    }
}

export async function createMessage(contacts: EnrichedContact[], supabase: SupabaseClient<Database>, overrides?: {
    generateEmail?: typeof generateEmail,
    generateTextMessage?: typeof generateTextMessage
}) {
    for (const contact of contacts) {
        try {
            validateContactInfo(contact);
            
            let messageResult: MessageResult;
            
            if (contact.email) {
                messageResult = await createEmail(contact, overrides);
            } else if (contact.phone) {
                messageResult = await createTextMessage(contact, overrides);
            } else {
                throw new Error('No valid contact method found');
            }
            
            await updateContactStatus(supabase, contact.id, 'ready_to_send', messageResult);
            
            logger.info('Successfully generated message for contact', {
                contactId: contact.id,
                contactName: contact.name,
                messageType: contact.email ? 'email' : 'text'
            });
            
        } catch (error) {
            logger.error('Error creating message for contact', {
                contactId: contact.id,
                contactName: contact.name,
                error: {
                    message: error instanceof Error ? error.message : String(error),
                    name: error instanceof Error ? error.name : 'Unknown',
                    stack: error instanceof Error ? error.stack : undefined
                }
            });
            
            await updateContactStatus(supabase, contact.id, 'failed');
        }
    }
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
    logger.info('Archiving message due to processing failure', { messageId: message.msg_id });
    const { error } = await pgmq_public.rpc('archive', {
        queue_name: CONSTANTS.QUEUE_NAME,
        message_id: message.msg_id,
    });
    if (error) {
        logger.error('Error archiving message', { error, messageId: message.msg_id });
        throw error;
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

export async function processMessages(messages: QueueMessage[], supabase: SupabaseClient<Database>, pgmq_public: SupabaseClient<Database, 'pgmq_public'>, overrides?: {
    generateEmail?: typeof generateEmail,
    generateTextMessage?: typeof generateTextMessage
}) {
    const zoomInfoIds = messages.map(msg => msg.message.contact_zoominfo_id);
    
    try {
        const contacts = await getContactsWithCompanyData(supabase, zoomInfoIds);
        
        if (contacts.length === 0) {
            logger.warn('No contacts found for ZoomInfo IDs', { zoomInfoIds });
            for (const message of messages) {
                await archiveMessage(pgmq_public, message);
            }
            return;
        }
        
        await createMessage(contacts, supabase, overrides);
        
        for (const message of messages) {
            await deleteMessage(pgmq_public, message);
        }
        
        logger.info('Successfully processed batch of messages', {
            messageCount: messages.length,
            contactCount: contacts.length
        });
        
    } catch (error) {
        logger.error('Error processing message batch', { error, messageCount: messages.length });
        
        for (const message of messages) {
            try {
                await archiveMessage(pgmq_public, message);
            } catch (archiveError) {
                logger.error('Failed to archive message after batch failure', {
                    messageId: message.msg_id,
                    archiveError
                });
            }
        }
        
        throw error;
    }
}

export const handler = async (req: Request, overrides?: {
    dequeueContacts?: typeof dequeueContacts,
    supabaseClients?: {
        supabase: SupabaseClient<Database>,
        pgmq_public: SupabaseClient<Database, 'pgmq_public'>
    },
    generateEmail?: typeof generateEmail,
    generateTextMessage?: typeof generateTextMessage
}) => {
    logger.info('Generate-message function started', {
        method: req.method,
        hasOverrides: !!overrides
    });

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

    const clients = overrides?.supabaseClients ?? createSupabaseClients(
        envVars.SUPABASE_URL,
        envVars.SUPABASE_SERVICE_ROLE_KEY
    );

    const dequeue = overrides?.dequeueContacts ?? dequeueContacts;

    try {
        const { data: messages } = await dequeue(clients.pgmq_public, CONSTANTS.BATCH_SIZE);

        if (messages.length === 0) {
            logger.info('No new messages to process');
            return new Response(JSON.stringify({
                message: 'No new messages to process'
            }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        logger.info('Processing contacts for message generation', { 
            messageCount: messages.length,
            messages: JSON.stringify(messages)
        });

        await processMessages(messages, clients.supabase, clients.pgmq_public, {
            generateEmail: overrides?.generateEmail,
            generateTextMessage: overrides?.generateTextMessage
        });

        return new Response(
            JSON.stringify({ message: 'Message generation processing complete' }),
            {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
            }
        );

    } catch (error) {
        logger.error('Error in generate-message handler', { error });
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            {
                status: 500,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
};

if (typeof Deno === 'undefined' || !Deno.test) {
  // @ts-ignore: Deno.serve is available in the Supabase Edge Runtime
  Deno.serve(handler);
}
