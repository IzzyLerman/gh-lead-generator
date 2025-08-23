/* Dequeue pgmq messages in batches of 5 and process the corresponding image with OCR, then upsert the data into the company table.
*/

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { encodeBase64 } from "jsr:@std/encoding/base64";
import { Database } from './../_shared/database.types.ts'
import { ParsedCompanyDataSchema, ParsedCompanyData } from "./../_shared/schema.ts";
import { mockVisionAPI } from "./vision-mocks.ts";
import { mockLLMAPI } from "./llm-mocks.ts";
import { createLogger } from './../_shared/logger.ts'
import { Image } from "npm:image-js";
import { S3Client, PutObjectCommand, GetObjectCommand } from "npm:@aws-sdk/client-s3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner";

const CONSTANTS = {
  BATCH_SIZE: 5,
  SIGNED_URL_EXPIRY: 60,
  SLEEP_SECONDS: 15,
  MAX_TOKENS: 1024,
  MODEL: "claude-3-5-haiku-20241022",
  QUEUE_NAME: "image-processing",
  CONTACT_QUEUE_NAME: "contact-enrichment",
  BUCKET_NAME: "gh-vehicle-photos",
  AWS_S3_BUCKET: "gh-vehicles-public"
} as const;

const parseVehicleImagePrompt = `Extract company information from the attached image of a Company truck: company name, primary industry, email, phone number, city, state, and website. Use the email and/or website as a partial clue for the company name if it's obscured by a logo. It is IMPERATIVE that you return your answer as JSON ONLY with no extra characters, notes, or formatting. 
        The JSON should followi this schema: 

{
        name: <company name>,
        industry: <array of industries as strings. examples are heating, cooling, ventilation, plumbing, fumigators, etc.>
        email: <email, pick the first if there are more than one>
        phone: <phone number, just pick the first one and only write the 10 digits NO dashes or parentheses>
        city: <city>
        state: <state>
        website: <website>
}`

function getEnvVar(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

// Initialize logger
const logger = createLogger('worker');

interface VisionAPIRequest {
  image: { source: { imageUri: string } };
  features: { type: string }[];
}

interface VisionAPIResponse {
  textAnnotations?: { description: string }[];
  error?: any;
}

export async function callVisionAPI(imageRequests: VisionAPIRequest[], url: string, key: string): Promise<VisionAPIResponse[]> {
  const response = await fetch(`${url}?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requests: imageRequests }),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vision API error ${response.status}: ${text}`);
  }
  const json = await response.json();
  if (!json.responses) throw new Error("Malformed Vision API response");
  return json.responses;
}

interface LLMAPIRequest {
  model: string;
  max_tokens: number;
  messages: { role: string; content: string }[];
}

interface LLMAPIResponse {
  content?: { text: string; type: string }[];
}

export async function callLLMAPI(request: LLMAPIRequest, url: string, key: string): Promise<LLMAPIResponse> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(request)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API error ${response.status}: ${text}`);
  }
  return response.json();
}

export async function mockProcessVehicleImage(imageUrl: string, parseVehicleImagePrompt: string, apiUrl: string, apiKey: string): Promise<ParsedCompanyData> {
  const mockCompanies = [
    {
      name: "ABC Plumbing Services",
      industry: ["plumbing"],
      email: "info@abcplumbing.com",
      phone: "5550101",
      city: "Dallas",
      state: "TX",
      website: "abcplumbing.com"
    },
    {
      name: "XYZ Electrical Corp",
      industry: ["electrical"],
      email: "contact@xyzelectric.com",
      phone: "5550202",
      city: "Houston",
      state: "TX",
      website: "xyzelectric.com"
    },
    {
      name: "DEF HVAC Solutions", 
      industry: ["heating", "cooling"],
      email: "service@defhvac.com",
      phone: "5550303",
      city: "Austin",
      state: "TX",
      website: "defhvac.com"
    },
    {
      name: "GHI Roofing Experts",
      industry: ["roofing"],
      email: "info@ghiroofing.com", 
      phone: "5550404",
      city: "San Antonio",
      state: "TX",
      website: "ghiroofing.com"
    },
    {
      name: "JKL Landscaping Pro",
      industry: ["landscaping"],
      email: "hello@jkllandscape.com",
      phone: "5550505", 
      city: "Fort Worth",
      state: "TX",
      website: "jkllandscape.com"
    }
  ];

  const randomIndex = Math.floor(Math.random() * mockCompanies.length);
  const selectedCompany = mockCompanies[randomIndex];
  
  logger.info('Mock vehicle image processing', {
    imageUrl,
    selectedCompany: selectedCompany.name
  });

  await new Promise(resolve => setTimeout(resolve, 100));
  
  return selectedCompany;
}

export async function processVehicleImage(imageUrl: string, parseVehicleImagePrompt: string, apiUrl: string, apiKey: string): Promise<ParsedCompanyData> {
  const requestBody = {
    model: CONSTANTS.MODEL,
    max_tokens: CONSTANTS.MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              "type": "url",
              "url": imageUrl
            }
          },
          {
            type: "text",
            text: parseVehicleImagePrompt
          }
        ]
      }
    ]
  };

  logger.debug('Sending vehicle image processing request', {
    model: requestBody.model,
    maxTokens: requestBody.max_tokens,
    messageCount: requestBody.messages.length
  });

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Vehicle image processing API error ${response.status}: ${text}`);
  }

  const result = await response.json();
  
  if (!result.content?.[0]?.text) {
    throw new Error("Malformed API Response");
  }

  logger.info('LLM response received', {
    responseText: result.content[0].text
  });

  const sanitized = sanitizeLLMJsonResponse(result.content[0].text);
  const validationResult = ParsedCompanyDataSchema.safeParse(sanitized);
  
  if (!validationResult.success) {
    logger.error('Vehicle image processing output validation failed', {
      errorMessage: validationResult.error.message,
      errorCount: validationResult.error.errors?.length || 0
    });
    throw new Error(`Output validation failed: ${validationResult.error.message}`);
  }

  return sanitized;
}




export function sanitizeLLMJsonResponse(jsonString: string): any {
  const trimmed = jsonString.trim();
  const cleaned = trimmed.replace(/\n/g, ' ').replace(/\s+/g, ' ');
  const parsed = JSON.parse(cleaned);
  
  const sanitized: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(parsed)) {
    if (value === null) {
      sanitized[key] = "";
    } else if (Array.isArray(value)) {
      sanitized[key] = value.filter(item => item !== null && item !== "");
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

export function removeEmptyFields(obj: Record<string, any>): Record<string, any> {
  const filtered: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      // Filter out empty strings from arrays
      const nonEmptyArray = value.filter(item => item !== "");
      if (nonEmptyArray.length > 0) {
        filtered[key] = nonEmptyArray;
      }
    } else if (value !== "" && value !== null && value !== undefined) {
      // Include non-empty strings
      filtered[key] = value;
    }
  }
  
  return filtered;
}

interface CompanyUpsertData {
  name: string;
  email?: string;
  phone?: string;
  industry?: string[];
  city?: string;
  state?: string;
  website?: string;
}

interface UpsertResult {
  company_id: string;
  was_insert: boolean;
}

export const upsertCompany = async (supabase: SupabaseClient<Database>, company: CompanyUpsertData) => {
  if (!supabase || !company.name) {
    const errorMessage = "Supabase client and company name are required.";
    logger.error('Invalid upsert parameters', {
      hasSupabase: !!supabase,
      hasCompanyName: !!company.name
    });
    return { data: null, success: false, error: { message: errorMessage } };
  }

  try {
    const { data, error } = await supabase.schema('private').rpc('upsert_company', {
      p_name: company.name,
      p_email: company.email || '',
      p_phone: company.phone || '',
      p_industry: company.industry || [],
      p_city: company.city || '',
      p_state: company.state || '',
      p_website: company.website || ''
    });

    if (error) {
      // Re-throw the error to be caught by the calling try/catch block
      throw(error);
    }

    logger.info('Company upserted successfully', { companyName: company.name });
    return { data, success: true, error: null };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.logError(error instanceof Error ? error : new Error(String(error)), 'Error upserting company', { companyName: company.name });
    return { data: null, success: false, error };
  }
};

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

interface QueueMessage {
  id: number;
  msg_id: number;
  message: { image_path: string };
}

interface SignedUrlResult {
  signedUrl: string;
  messageId: number;
}

export async function generateSignedUrls(supabase: SupabaseClient<Database>, messages: QueueMessage[]): Promise<{ urls: SignedUrlResult[] | null; num: number }> {
    if (!messages || messages.length === 0) {
        return { urls: null, num: 0 };
    }

    // Filter out test messages and messages without image_path
    const validMessages = messages.filter(message => message.message?.image_path);
    if (validMessages.length === 0) {
        logger.info('No valid messages with image_path found', {
          totalMessages: messages.length,
          validMessages: 0
        });
        return { urls: null, num: 0 };
    }

    const signedUrlPromises = validMessages.map(message => 
        supabase.storage
            .from(CONSTANTS.BUCKET_NAME)
            .createSignedUrl(message.message.image_path, CONSTANTS.SIGNED_URL_EXPIRY)
            .then(({ data, error }) => {
                if (error) {
                    throw new Error(`Failed to create signed URL for ${message.message.image_path}: ${error.message}`);
                }
                return { signedUrl: data.signedUrl, messageId: message.msg_id };
            })
    );

    const signedUrls = await Promise.all(signedUrlPromises);
    logger.info('Generated signed URLs for processing', {
      messageCount: signedUrls.length,
      totalRequested: messages.length
    });
    return { urls: signedUrls, num: signedUrls.length };
}

export async function generateSignedUrlsLocal(supabase: SupabaseClient<Database>, messages: QueueMessage[]): Promise<{ urls: SignedUrlResult[] | null; num: number }> {
    if (!messages || messages.length === 0) {
        return { urls: null, num: 0 };
    }

    const validMessages = messages.filter(message => message.message?.image_path);
    if (validMessages.length === 0) {
        logger.info('No valid messages with image_path found', {
          totalMessages: messages.length,
          validMessages: 0
        });
        return { urls: null, num: 0 };
    }

    const s3Client = new S3Client({
        region: getEnvVar('AWS_REGION'),
        credentials: {
            accessKeyId: getEnvVar('AWS_ACCESS_KEY_ID'),
            secretAccessKey: getEnvVar('AWS_SECRET_ACCESS_KEY')
        }
    });

    const uploadPromises = validMessages.map(async (message) => {
        try {
            const { data: fileData, error } = await supabase.storage
                .from(CONSTANTS.BUCKET_NAME)
                .download(message.message.image_path);

            if (error) {
                throw new Error(`Failed to download image from ${message.message.image_path}: ${error.message}`);
            }

            const arrayBuffer = await fileData.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            
            const key = `images/${message.message.image_path}`;
            
            const uploadCommand = new PutObjectCommand({
                Bucket: CONSTANTS.AWS_S3_BUCKET,
                Key: key,
                Body: uint8Array,
                ContentType: fileData.type || 'application/octet-stream'
            });

            await s3Client.send(uploadCommand);

            const getCommand = new GetObjectCommand({
                Bucket: CONSTANTS.AWS_S3_BUCKET,
                Key: key
            });

            const signedUrl = await getSignedUrl(s3Client, getCommand, {
                expiresIn: CONSTANTS.SIGNED_URL_EXPIRY
            });

            logger.debug('Image uploaded to S3 and signed URL generated', {
                imagePath: message.message.image_path,
                s3Key: key,
                messageId: message.msg_id,
                signedUrl: signedUrl
            });

            return { signedUrl, messageId: message.msg_id };

        } catch (error) {
            logger.logError(error instanceof Error ? error : new Error(String(error)), 'Error uploading image to S3', {
                imagePath: message.message.image_path,
                messageId: message.msg_id
            });
            throw error;
        }
    });

    const signedUrls = await Promise.all(uploadPromises);
    logger.info('Generated S3 signed URLs for processing', {
      messageCount: signedUrls.length,
      totalRequested: messages.length
    });
    
    return { urls: signedUrls, num: signedUrls.length };
}

async function deleteMessage(pgmq_public: SupabaseClient<Database, 'pgmq_public'>, message: QueueMessage) {
    const { error } = await pgmq_public.rpc('delete', {
        queue_name: CONSTANTS.QUEUE_NAME,
        message_id: message.msg_id,
    });
    if (error) {
        logger.logError(error, 'Error deleting message', {
          messageId: message.msg_id,
          imagePath: message.message.image_path
        });
        throw error;
    } else {
        logger.debug('Message deleted successfully', {
          messageId: message.msg_id
        });
    }
}

async function archiveMessage(pgmq_public: SupabaseClient<Database, 'pgmq_public'>, message: QueueMessage) {
    logger.warn('Fatal error processing image - archiving message', {
      messageId: message.msg_id,
      imagePath: message.message.image_path
    });
    const { error } = await pgmq_public.rpc('archive', {
        queue_name: CONSTANTS.QUEUE_NAME,
        message_id: message.msg_id,
    });
    if (error) {
        logger.logError(error, 'Error archiving message', {
          messageId: message.msg_id
        });
        throw error;
    } else {
        logger.info('Message archived successfully', {
          messageId: message.msg_id
        });
    }
}


export async function triggerWorker(supabase: SupabaseClient<Database>) {
    const SUPABASE_SERVICE_ROLE_KEY = getEnvVar('SUPABASE_SERVICE_ROLE_KEY');
    await supabase.functions.invoke('worker', {
        headers: { 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` }
    });
}

export async function enqueueForContactEnrichment(pgmq_public: SupabaseClient<Database, 'pgmq_public'>, companyId: string) {
    const { error } = await pgmq_public.rpc('send', {
        queue_name: CONSTANTS.CONTACT_QUEUE_NAME,
        message: { company_id: companyId }
    });

    if (error) {
        logger.logError(error, 'Error enqueueing company for contact enrichment', {
          companyId
        });
        throw error;
    }

    logger.info('Company enqueued for contact enrichment', {
      companyId,
      queue: CONSTANTS.CONTACT_QUEUE_NAME
    });
}

const OCR_PROMPT = {
  head: `
    The following is the result of OCR on an image of a company vehicle. Parse the information in the vehicle into the following JSON format. !!IMPORTANT!! Only use information from the image. If a field is not represented in the ocr output, write a blank string (or empty list if its the industry field). !!ALSO IMPORTANT!! Formatting the output correctly is of utmost importance. Only return the raw JSON as your response. it should look like this:

    {
        name: <company name>,
        industry: <array of industries as strings. examples are heating, cooling, ventilation, plumbing, fumigators, etc.>
        email: <email, pick the first if there are more than one>
        phone: <phone number, just pick the first one and only write the 10 digits NO dashes or parentheses>
        city: <city>
        state: <state>
        website: <website>
    }

    <BEGIN OCR OUTPUT>\n
    `,
  footer: `\n<END OCR OUTPUT>`
} as const;

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

export async function processOCRWithLLM(ocrResponses: VisionAPIResponse[], llmAPI: typeof callLLMAPI, apiUrl: string, apiKey: string): Promise<ParsedCompanyData[]> {
  const llmRequests = ocrResponses.map(res => {
    if (!res.textAnnotations?.[0]?.description) {
      throw new Error("No text found in OCR response");
    }
    return {
      model: CONSTANTS.MODEL,
      max_tokens: CONSTANTS.MAX_TOKENS,
      messages: [{
        role: "user",
        content: OCR_PROMPT.head + res.textAnnotations[0].description + OCR_PROMPT.footer
      }]
    };
  });

  const llmPromises = llmRequests.map(async (request, idx) => {
    logger.debug('Sending LLM request', {
      requestIndex: idx,
      model: request.model,
      maxTokens: request.max_tokens,
      messageCount: request.messages.length
      // NOTE: Not logging actual OCR content for security
    });
    return await llmAPI(request, apiUrl, apiKey);
  });

  const llmResults = await Promise.all(llmPromises);
  logger.info('LLM processing completed', {
    requestCount: llmRequests.length,
    resultCount: llmResults.length,
    successCount: llmResults.filter(r => r.content?.[0]?.text).length
    // NOTE: Not logging actual parsed content for security
  });

  return llmResults.map((res, idx) => {
    if (!res.content?.[0]?.text) {
      throw new Error("Malformed LLM Response");
    }
    const parsed = JSON.parse(res.content[0].text);
    const result = ParsedCompanyDataSchema.safeParse(parsed);
    if (!result.success) {
      logger.error('LLM output validation failed', {
        messageIndex: idx,
        errorMessage: result.error.message,
        errorCount: result.error.errors?.length || 0
      });
      throw new Error(`LLM output validation failed: ${result.error.message}`);
    }
    return parsed;
  });
}

function removeCompanyLLCSuffix(companyName: string): string {
  return companyName.replace(/\s+LLC\s*$/i, '').trim();
}

function normalizeCompanyData(parsedData: ParsedCompanyData[]): CompanyUpsertData[] {
  return parsedData.map(json => removeEmptyFields({
    name: removeCompanyLLCSuffix(json.name),
    industry: json.industry,
    email: json.email,
    phone: json.phone,
    city: json.city,
    state: json.state,
    website: json.website
  }) as CompanyUpsertData);
}

async function processMessages(companies: CompanyUpsertData[], messages: QueueMessage[], supabase: SupabaseClient<Database>, pgmq_public: SupabaseClient<Database, 'pgmq_public'>) {
  const processPromises = companies.map(async (company, idx) => {
    const message = messages[idx];
    const pathname = message.message.image_path;
    // Since we now store full upload paths in vehicle-photos, use the full path
    const vehiclePhotoName = pathname;
    
    try {
      const result = await upsertCompany(supabase, company);
      
      if (!result.success) {
        logger.error('Error upserting company', { companyName: company.name, error: result.error });
        
        // Mark photo as failed
        await supabase
          .from('vehicle-photos')
          .update({ status: 'failed' })
          .eq('name', vehiclePhotoName);
          
        await archiveMessage(pgmq_public, message);
      } else {
      // Extract company_id and insert flag from the new return format
      const upsertResult = result.data as unknown as UpsertResult & { skipped?: boolean; reason?: string };
      const companyId = upsertResult.company_id;
      let wasInsert = upsertResult.was_insert;
      
      // Check if company was skipped due to 'sent' status
      if (upsertResult.skipped) {
        logger.info('Company processing skipped', { 
          companyName: company.name, 
          reason: upsertResult.reason 
        });
        
        // Update vehicle_photos table with company_id and mark as processed
        const { error: updateError } = await supabase
          .from('vehicle-photos')
          .update({ 
            company_id: companyId,
            status: 'processed'
          })
          .eq('name', vehiclePhotoName);
        
        if (updateError) {
          logger.logError(updateError, 'Error updating vehicle_photos with company_id', {
            companyId,
            imagePath: vehiclePhotoName
          });
          throw updateError;
        }
        
        await deleteMessage(pgmq_public, message);
        return;
      }
      
      logger.info('Successfully upserted company', { companyName: company.name });
      const { error: updateError } = await supabase
        .from('vehicle-photos')
        .update({ 
          company_id: companyId,
          status: 'processed'
        })
        .eq('name', vehiclePhotoName);
      
      if (updateError) {
        logger.logError(updateError, 'Error updating vehicle_photos with company_id', {
          companyId,
          imagePath: vehiclePhotoName
        });
        throw updateError; // Re-throw to trigger failure handling
      } else {
        logger.debug('Vehicle photo linked to company and marked as processed', {
          companyId,
          imagePath: vehiclePhotoName
        });
      }
      
      // Only enqueue for contact enrichment if this was a new company (insert)
      // MODIFIED: always enqueue for now since some existing companies are messed updateError
      wasInsert = true;
      if (wasInsert) {
        try {
          await enqueueForContactEnrichment(pgmq_public, companyId);
          logger.info('New company enqueued for contact enrichment', {
            companyName: company.name,
            companyId
          });
        } catch (error) {
          logger.logError(error instanceof Error ? error : new Error(String(error)), 'Error enqueueing company for contact enrichment', {
            companyName: company.name,
            companyId
          });
          // Don't fail the entire process if enqueueing fails
        }
      }
      
      await deleteMessage(pgmq_public, message);
      }
    } catch (error) {
      logger.logError(error instanceof Error ? error : new Error(String(error)), 'Error processing message', {
        messageId: message.msg_id,
        imagePath: vehiclePhotoName,
        companyName: company.name
      });
      
      // Mark photo as failed
      await supabase
        .from('vehicle-photos')
        .update({ status: 'failed' })
        .eq('name', vehiclePhotoName);
        
      await archiveMessage(pgmq_public, message);
    }
  });

  await Promise.all(processPromises);
  
  logger.info('Batch processing completed', {
    messageCount: messages.length,
    processedCount: processPromises.length
  });
}



export const handler = async (req: Request, overrides?: {
    dequeueElement?: typeof dequeueElement,
    callVisionAPI?: typeof callVisionAPI,
    callLLMAPI?: typeof callLLMAPI,
    generateSignedUrls?: typeof generateSignedUrls
}) => {
    logger.info('Worker function started', {
      method: req.method,
      hasOverrides: !!overrides
    });
    const envVars = {
      SUPABASE_URL: getEnvVar('SUPABASE_URL'),
      SUPABASE_SERVICE_ROLE_KEY: getEnvVar('SUPABASE_SERVICE_ROLE_KEY'),
      ANTHROPIC_API_KEY: getEnvVar('ANTHROPIC_API_KEY'),
      ANTHROPIC_API_URL: getEnvVar('ANTHROPIC_API_URL'),
      VISION_API_URL: getEnvVar('VISION_API_URL'),
      VISION_API_KEY: getEnvVar('VISION_API_KEY')
    };

    const { supabase, pgmq_public } = createSupabaseClients(
      envVars.SUPABASE_URL, 
      envVars.SUPABASE_SERVICE_ROLE_KEY
    );

    const environment = getEnvVar("ENVIRONMENT");

    const dequeue = overrides?.dequeueElement ?? dequeueElement;
    const generateUrls = environment === "local" ? generateSignedUrlsLocal : generateSignedUrls;
    
    

    try {
      logger.step('Dequeuing messages from queue');
      const { data: messages } = await dequeue(pgmq_public, CONSTANTS.BATCH_SIZE);
      const numMessages = messages.length;

      if (numMessages === 0) {
          logger.info('No new messages to process');
          return new Response(JSON.stringify({ 
              status: 200,
              headers: { 'Content-Type': 'application/json' },
              message: 'No new messages'
          }));
      }
      
      logger.step('Processing vehicle images', { messageCount: numMessages });
      const {urls, num} = await generateUrls(supabase, messages);

      if (!urls){
          throw new Error("Error generating signed Urls, returned null");
      }

      const processFunction = environment === "test" ? mockProcessVehicleImage : processVehicleImage;
      const parsedCompanies = await Promise.all(
        urls.map(async (urlResult) => {
          return await processFunction(urlResult.signedUrl, parseVehicleImagePrompt, envVars.ANTHROPIC_API_URL, envVars.ANTHROPIC_API_KEY);
        })
      );
    

      logger.step('Normalizing company data');
      const normalizedCompanies = normalizeCompanyData(parsedCompanies);
      
      logger.step('Processing messages and upserting companies');
      await processMessages(normalizedCompanies, messages, supabase, pgmq_public);
      
      logger.info('Worker function completed successfully', {
        processedMessages: messages.length,
        companiesFound: normalizedCompanies.length
      });

    } catch (error) {
      logger.logError(error instanceof Error ? error : new Error(String(error)), 'Worker function failed');
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify({ message: 'Processed images successfully' }),
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


