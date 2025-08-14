/* Contact enrichment function that processes companies in batches of 5,
   finds additional contact information, and updates company status.
*/

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Database } from './../_shared/database.types.ts';
import { createZoomInfoService, type IZoomInfoService } from '../_shared/zoominfo-factory.ts';
import { 
  getCompanyFromZoomInfo, 
  getContactFromCompany, 
  enrichCompanyContact,
  type ZoomInfoContactData,
  type ZoomInfoEnrichedContactData
} from '../_shared/zoominfo-api.ts';
import { createLogger } from '../_shared/logger.ts';

const CONSTANTS = {
  BATCH_SIZE: 5,
  SLEEP_SECONDS: 15,
  QUEUE_NAME: "contact-enrichment",
  EMAIL_QUEUE_NAME: "email-generation",
  REVENUE_MIN_FILTER: 2000000
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
  message: { company_id: string; zoominfo_id?: number };
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
  zoominfo_id: number | null;
  revenue: number | null;
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

async function updateCompanyStatus(supabase: SupabaseClient<Database>, companyId: string, status: string, companyRevenue: number | null, zoominfo_id: number | null, companySicCodes?: string, companyNaicsCodes?: string, companyPrimaryIndustry?: string|null) {
    const updateData: any = { status: status, updated_at: new Date().toISOString() };
    if (zoominfo_id !== undefined) {
        updateData.zoominfo_id = zoominfo_id;
    }

    if (companyRevenue !== undefined && companyRevenue !== null) {
        updateData.revenue = companyRevenue;
    }

    if (companySicCodes !== undefined && companySicCodes !== null) {
        updateData.sic_codes = companySicCodes;
    }
    if (companyNaicsCodes !== undefined && companyNaicsCodes !== null) {
        updateData.naics_codes = companyNaicsCodes;
    }

    if (companyPrimaryIndustry !== undefined && companyPrimaryIndustry !== null){
        updateData.primary_industry = companyPrimaryIndustry;
    }

    logger.info(`updating company status: ${JSON.stringify(updateData)}`);

    const { error } = await supabase
        .from('companies')
        .update(updateData)
        .eq('id', companyId);

    if (error) {
        logger.error('Error updating company status', { companyId, status, zoominfo_id, error });
        throw error;
    }
}

async function lookupCompanyInZoomInfo(company: Company, zoomInfoService: IZoomInfoService): Promise<number | null> {
    logger.info('Looking up company in ZoomInfo', { companyId: company.id, companyName: company.name });
    
    try {
        const searchInput = {
            id: company.id,
            name: company.name,
            state: company.state || undefined,
            website: company.website || undefined,
            industries: company.industry && company.industry.length > 0 
                ? company.industry 
                : undefined,
        };
        
        // Debug logging for outgoing API call
        logger.debug('Making ZoomInfo progressive company search', {
            companyId: company.id,
            companyName: company.name,
            apiEndpoint: 'progressiveCompanySearch',
            searchInput: JSON.stringify(searchInput),
            searchInputDetailed: {
                name: searchInput.name,
                website: searchInput.website,
                state: searchInput.state,
                industries: searchInput.industries,
                hasWebsite: !!searchInput.website,
                hasState: !!searchInput.state,
                hasIndustries: !!searchInput.industries,
                industriesCount: searchInput.industries?.length || 0
            }
        });
        
        const zoomInfoResponse = await zoomInfoService.progressiveCompanySearch(searchInput);
        
        // Check if no results found
        if (!zoomInfoResponse) {
            logger.info('No company found in ZoomInfo after progressive search', {
                companyId: company.id,
                companyName: company.name
            });
            return null;
        }

        logger.info('ZoomInfo company lookup response', {
            companyId: company.id,
            companyName: company.name,
            totalResults: zoomInfoResponse.totalResults,
            hasResults: zoomInfoResponse.data?.length > 0
        });
        
        // Check if no results found
        if (!zoomInfoResponse.data || zoomInfoResponse.data.length === 0) {
            logger.info('No company found in ZoomInfo', {
                companyId: company.id,
                companyName: company.name,
                totalResults: zoomInfoResponse.totalResults
            });
            return null;
        }
        
        // Extract company ID from the first result
        const zoomInfoCompanyId = zoomInfoResponse.data[0].id;
        
        
        return zoomInfoCompanyId;
    } catch (error) {
        logger.error('Error looking up company in ZoomInfo', { companyId: company.id, companyName: company.name, error });
        throw new Error(`Failed to lookup company ${company.name} in ZoomInfo: ${error instanceof Error ? error.message : String(error)}`);
    }
}

async function uploadContactsToEmailQueue(enrichedContacts: ZoomInfoEnrichedContactData[], pgmq_public: SupabaseClient<Database, 'pgmq_public'>): Promise<void> {
    logger.info('Uploading contacts to email generation queue', { 
        contactCount: enrichedContacts.length 
    });
    
    try {
        // Upload each contact ID to the email-generation queue
        for (const contact of enrichedContacts) {
            const { error } = await pgmq_public.rpc('send', {
                queue_name: CONSTANTS.EMAIL_QUEUE_NAME,
                message: { contact_zoominfo_id: contact.zoominfo_id }
            });
            
            if (error) {
                logger.error('Error uploading contact to email queue', { 
                    contact: contact.id, 
                    error 
                });
                throw error;
            }
        }
        
        logger.info('Successfully uploaded contacts to email generation queue', { 
            contactCount: enrichedContacts.length

        });
    } catch (error) {
        logger.error('Error in uploadContactsToEmailQueue', { 
            contactCount: enrichedContacts.length, 
            error 
        });
        throw error;
    }
}

async function storeEnrichedContacts(enrichedContacts: any[], companyId: string, supabase: SupabaseClient<Database>, execs: Boolean): Promise<{contactIds: string[], validContactsForQueue: any[]}> {
    logger.info('Storing enriched contacts', { 
        companyId, 
        contactCount: enrichedContacts.length 
    });
    
    try {
        const contactsToInsert = enrichedContacts.map(contact => {
            let status = 'generating_message';
            if  (execs !== true) {
                status = 'non-executive';
            } else if (!contact.email && !contact.phone && !contact.mobilePhone) {
                status = 'no_contact';
            }
            logger.info(`Gave contact ${contact.firstName} ${contact.lastName} status ${status}. exec = ${execs}`); 
            return {
                company_id: companyId,
                name: `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
                first_name: contact.firstName || null,
                middle_name: contact.middleName || null,
                last_name: contact.lastName || null,
                title: contact.jobTitle || null,
                email: contact.email || null,
                phone: contact.mobilePhone || contact.phone || null,
                zoominfo_id: contact.id,
                status: status,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
        });



        const data = await Promise.all(contactsToInsert.map(async (contact) => {
            const {data: existingData, error: selectError} = await supabase
                .from("contacts")
                .select("zoominfo_id")
                .eq("zoominfo_id", contact.zoominfo_id);

            if(selectError) throw new Error("Failed to query the contacts tables for existing contact.");

            if( existingData && existingData.length > 0){
                logger.info(`updating existing contact`);
                const {data: updateData, error: updateError} = await supabase
                    .from("contacts")
                    .update(contact)
                    .eq("zoominfo_id", contact.zoominfo_id);
                    
                if (updateError) {
                    logger.error('Error updating existing contact', { 
                        companyId, 
                        contactZoomInfoId: contact.zoominfo_id,
                        error: updateError 
                    });
                    throw updateError;
                }
                logger.info(`success updating existing contact`);
                return updateData;
            } else {
                const {data: insertData, error: insertError} = await supabase
                    .from("contacts")
                    .insert(contact);
                    
                if (insertError) {
                    logger.error('Error inserting new contact', { 
                        companyId, 
                        contactZoomInfoId: contact.zoominfo_id,
                        error: insertError 
                    });
                    throw insertError;
                }
                return insertData;
            }
        }));

        logger.info(`Completed upload; data = ${JSON.stringify(data)}`);
        

        const contactIds = enrichedContacts.map(contact => contact.id);
        const validContactsForQueue = contactsToInsert.filter(contact => 
            contact.status === 'generating_message'
        );
        
        logger.info('Successfully stored enriched contacts', { 
            companyId, 
            contactCount: enrichedContacts.length,
            contactIds,
            validForQueue: validContactsForQueue.length
        });
        
        return { contactIds, validContactsForQueue };
    } catch (error) {
        logger.error('Error in storeEnrichedContacts', { 
            companyId, 
            contactCount: enrichedContacts.length, 
            error 
        });
        throw error;
    }
}

function isExecutive(jobTitle: string) {
    if( jobTitle.includes("Owner") || jobTitle.includes("Founder") || jobTitle.includes("CEO")){
        return true;
    }
    if ( jobTitle.includes("President") && !jobTitle.includes("Vice")){
        return true;
    }
    if ( jobTitle === "Admin" || jobTitle === "Chief Executive Officer" || jobTitle === "Superintendent"){
        return true;
    }

    /*if ( jobTitle === "Manager" || jobTitle === "General Manager" ) {
        return true;
    }*/

    if ( jobTitle === "Managing Director" || jobTitle === "Director" || jobTitle === "Proprietor" || jobTitle === "Principal") {
        return true;
    }

    return false;
}

function extractSicCodes(sicCodes: Array<{id: string, name: string}>): string {
    return sicCodes.map(code => code.id).join(',');
}

function extractNaicsCodes(naicsCodes: Array<{id: string, name: string}>): {codes: string, primaryIndustry: string | null} {
    const codes = naicsCodes.map(code => code.id).join(',');
    
    const mostSpecificCode = naicsCodes.reduce((longest, current) => 
        current.id.length > longest.id.length ? current : longest
    );
    
    return {
        codes,
        primaryIndustry: mostSpecificCode.name
    };
}

async function enrichCompanyContacts(company: Company, zoomInfoService: IZoomInfoService, supabase: SupabaseClient<Database>, pgmq_public: SupabaseClient<Database, 'pgmq_public'>, providedZoomInfoId?: number): Promise<void> {
    logger.info('Enriching contacts for company', { companyId: company.id, companyName: company.name, providedZoomInfoId });
    
    try {
        let zoomInfoCompanyId: number | null;
        
        if (providedZoomInfoId) {
            logger.info('Using provided ZoomInfo ID, skipping company lookup', { 
                companyId: company.id, 
                providedZoomInfoId 
            });
            zoomInfoCompanyId = providedZoomInfoId;
        } else {
            zoomInfoCompanyId = await lookupCompanyInZoomInfo(company, zoomInfoService);
            
            if (!zoomInfoCompanyId) {
                await updateCompanyStatus(supabase, company.id, 'not_found', null, null);
                logger.info('Company not found in ZoomInfo, marked as not_found', {
                    companyId: company.id,
                    companyName: company.name
                });
                return;
            }
        }
        
        logger.info('Getting contacts from company', { zoomInfoCompanyId });
        
        const searchParams = {
            companyId: zoomInfoCompanyId.toString()
        };
        
        const contactResponse = await zoomInfoService.searchContacts(searchParams);
        
        logger.info('ZoomInfo contact search response', {
            zoomInfoCompanyId,
            totalResults: contactResponse.totalResults,
            contactCount: contactResponse.data?.length || 0
        });
        
        const contacts = contactResponse.data || [];
        
        logger.debug('Contact search results', {
            zoomInfoCompanyId,
            contacts: contacts.map(contact => ({
                id: contact.id,
                hasEmail: contact.hasEmail,
                hasDirect: contact.hasDirect,
                hasPhone: contact.hasPhone,
                firstName: contact.firstName,
                lastName: contact.lastName,
                jobTitle: contact.jobTitle,
                contactFlags: {
                    hasEmail: contact.hasEmail,
                    hasDirect: contact.hasDirect,
                    hasPhone: contact.hasPhone
                }
            }))
        });
        
        logger.info('Enriching contacts', { contactCount: contacts.length });
        
        if (!contacts || contacts.length === 0) {
            logger.info('No contacts to enrich');
            await updateCompanyStatus(supabase, company.id, 'contacts_failed', null, zoomInfoCompanyId);
            return;
        }

        let contactsToEnrich: any[] = [];
        let nonExecutiveContacts: any[] = [];
      
        contacts.forEach( (contact) => {
            if (isExecutive(contact.jobTitle)){
                contactsToEnrich.push(contact);
            }else {
                nonExecutiveContacts.push({
                    id: contact.id,
                    firstName: contact.firstName,
                    lastName: contact.lastName,
                    jobTitle: contact.jobTitle
                });
            }
        }); 

        if (contactsToEnrich.length === 0) {
            logger.info('No contacts meet enrichment criteria');
            await updateCompanyStatus(supabase, company.id, 'no_execs', null, zoomInfoCompanyId);
            if (nonExecutiveContacts.length > 0){
                storeEnrichedContacts(
                    nonExecutiveContacts,
                    company.id,
                    supabase,
                    false
                );
            }
            return;
        }
        
        logger.info('Filtered contacts for enrichment', { 
            originalCount: contacts.length,
            filteredCount: contactsToEnrich.length
        });
        
        // Prepare enrichment params
        const enrichParams = {
            matchPersonInput: contactsToEnrich.map((contact: ZoomInfoContactData) => ({ personId: contact.id })),
            outputFields: [
                "firstName",
                "lastName",
                "email",
                "hasCanadianEmail",
                "phone",
                "mobilePhone",
                "directPhoneDoNotCall",
                "street",
                "jobTitle",
                "jobFunction",
                "hashedEmails",
                "managementLevel",
                "contactAccuracyScore",
                "mobilePhoneDoNotCall",
                "companyRevenueNumeric",
                "companySicCodes",
                "companyNaicsCodes",
                "companyIndustries",
                "lastUpdatedDate",
                "externalUrls"
            ]
        };
        
        logger.info('Making ZoomInfo enrichment request', {
            contactsToEnrich: contactsToEnrich.length,
            personIds: contactsToEnrich.map(c => c.id),
            enrichParams: JSON.stringify(enrichParams)
        });

        const enrichResponse = await zoomInfoService.enrichContacts(enrichParams);
        
        logger.info('ZoomInfo contact enrichment response', {
            totalResults: enrichResponse.totalResults,
            enrichedCount: enrichResponse.data.result.length || 0,
            rawResponse: JSON.stringify(enrichResponse)
        });
        
        const enrichedContacts = enrichResponse.data.result.map((result) => result.data[0]);  
        // Debug logging for enriched contact results
        logger.debug('Contact enrichment results', {
            enrichedContactsCount: enrichedContacts.length,
            enrichedContacts: enrichedContacts.map(contact => ({
                id: contact.id,
                firstName: contact.firstName,
                lastName: contact.lastName,
                email: contact.email,
                phone: contact.mobilePhone,
                jobTitle: contact.jobTitle,
                companyRevenueNumeric: contact.companyRevenueNumeric,
                managementLevel: contact.managementLevel,
                contactAccuracyScore: contact.contactAccuracyScore
            }))
        });
        let companyRevenue: number | null = null;
        let companySicCodes: string = '';
        let companyNaicsCodes: string = '';
        let companyPrimaryIndustry = null;
        if (enrichedContacts.length > 0){
            const company:any = enrichedContacts[0].company;
            if (company && company.revenueNumeric){
                companyRevenue = company.revenueNumeric;
            }
            if (company && company.sicCodes){
                companySicCodes = extractSicCodes(company.sicCodes); 
            }
            if (company && company.naicsCodes){
                const naicsResult = extractNaicsCodes(company.naicsCodes);
                companyNaicsCodes = naicsResult.codes;
                companyPrimaryIndustry = naicsResult.primaryIndustry;
            }
        }
        if (enrichedContacts.length > 0) {
            const { validContactsForQueue } = await storeEnrichedContacts(
                enrichedContacts, 
                company.id, 
                supabase,
                true
            );
            
            if (validContactsForQueue.length > 0) {
                await uploadContactsToEmailQueue(validContactsForQueue, pgmq_public);
            }
        }
        if (nonExecutiveContacts.length > 0){
            storeEnrichedContacts(
                nonExecutiveContacts,
                company.id,
                supabase,
                false
            );
        }

        
        let finalStatus = 'processed';
        if (companyRevenue && companyRevenue < CONSTANTS.REVENUE_MIN_FILTER){
            finalStatus = 'low_revenue';
        }
        
        await updateCompanyStatus(supabase, company.id, finalStatus, companyRevenue, zoomInfoCompanyId, companySicCodes, companyNaicsCodes, companyPrimaryIndustry);
        
        logger.info('Successfully enriched contacts for company', {
            companyId: company.id,
            companyName: company.name,
            zoomInfoCompanyId,
            totalEnrichedContacts: enrichedContacts.length,
            finalStatus
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

async function processCompanies(messages: QueueMessage[], supabase: SupabaseClient<Database>, pgmq_public: SupabaseClient<Database, 'pgmq_public'>, zoomInfoService: IZoomInfoService) {
    const results = await Promise.allSettled(
        messages.map(async (message) => {
            const companyId = message.message.company_id;
            
            try {
                const company = await getCompanyById(supabase, companyId);
                if (!company) {
                    logger.error('Company not found', { companyId });
                    await archiveMessage(pgmq_public, message);
                    return { success: false, companyId, error: `Company ${companyId} not found` };
                }

                const providedZoomInfoId = message.message.zoominfo_id;
                await enrichCompanyContacts(company, zoomInfoService, supabase, pgmq_public, providedZoomInfoId);
                
                await deleteMessage(pgmq_public, message);
                
                logger.info('Successfully processed company', { companyId, companyName: company.name });
                return { success: true, companyId, companyName: company.name };
                
            } catch (error) {
                logger.error('Error processing company', { companyId, error });
                
                try {
                    await updateCompanyStatus(supabase, companyId, 'error', null, null);
                    await archiveMessage(pgmq_public, message);
                } catch (cleanupError) {
                    logger.error('Error during cleanup for company', { companyId, cleanupError });
                }
                
                return { success: false, companyId, error: error instanceof Error ? error.message : String(error) };
            }
        })
    );

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
    zoomInfoService?: IZoomInfoService,
    supabaseClients?: {
        supabase: SupabaseClient<Database>,
        pgmq_public: SupabaseClient<Database, 'pgmq_public'>
    },
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

    const dequeue = overrides?.dequeueElement ?? dequeueElement;
    const zoomInfoService = overrides?.zoomInfoService ?? createZoomInfoService(
      envVars.SUPABASE_URL,
      envVars.SUPABASE_SERVICE_ROLE_KEY
    );

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
      
      await processCompanies(messages, supabase, pgmq_public, zoomInfoService);

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
