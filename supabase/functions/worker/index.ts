/* Dequeue pgmq messages in batches of 5 and process the corresponding image with OCR, then upsert the data into the company table.
*/

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { Database } from './../_shared/database.types.ts'
import { ParsedCompanyDataSchema, ParsedCompanyData } from "./../_shared/schema.ts";

const CONSTANTS = {
  BATCH_SIZE: 5,
  SIGNED_URL_EXPIRY: 60,
  SLEEP_SECONDS: 15,
  MAX_TOKENS: 1024,
  MODEL: "claude-3-5-haiku-20241022",
  QUEUE_NAME: "image-processing",
  CONTACT_QUEUE_NAME: "contact-enrichment",
  BUCKET_NAME: "gh-vehicle-photos"
} as const;

function getEnvVar(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

function log(message: string, ...args: unknown[]) {
  console.log(`[worker] ${message}`, ...args);
}

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
}

interface UpsertResult {
  company_id: string;
  was_insert: boolean;
}

export const upsertCompany = async (supabase: SupabaseClient<Database>, company: CompanyUpsertData) => {
  if (!supabase || !company.name) {
    const errorMessage = "Supabase client and company name are required.";
    log(errorMessage);
    return { data: null, success: false, error: { message: errorMessage } };
  }

  try {
    const { data, error } = await supabase.schema('private').rpc('upsert_company', {
      p_name: company.name,
      p_email: company.email || '',
      p_phone: company.phone || '',
      p_industry: company.industry || [],
      p_city: company.city || '',
      p_state: company.state || ''
    });

    if (error) {
      // Re-throw the error to be caught by the calling try/catch block
      throw(error);
    }

    log(`Successfully upserted company: ${company.name}`);
    return { data, success: true, error: null };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error upserting company '${company.name}':`, errorMessage);
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

    const signedUrlPromises = messages.map(message => 
        supabase.storage
            .from(CONSTANTS.BUCKET_NAME)
            .createSignedUrl(message.message.image_path, CONSTANTS.SIGNED_URL_EXPIRY)
            .then(({ data, error }) => {
                if (error) {
                    throw new Error(`Failed to create signed URL for ${message.message.image_path}: ${error.message}`);
                }
                return { signedUrl: data.signedUrl, messageId: message.id };
            })
    );

    const signedUrls = await Promise.all(signedUrlPromises);
    log(`Processing ${signedUrls.length} messages`);
    return { urls: signedUrls, num: signedUrls.length };
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
    log(`Fatal error processing image. Archiving message with image_path: ${message.message.image_path}`);
    const { error } = await pgmq_public.rpc('archive', {
        queue_name: CONSTANTS.QUEUE_NAME,
        message_id: message.msg_id,
    });
    if (error) {
        log('Error archiving message:', error);
        throw error;
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
        log('Error enqueueing company for contact enrichment:', error);
        throw error;
    }

    log(`Successfully enqueued company ${companyId} for contact enrichment`);
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

  const llmPromises = llmRequests.map(async (request) => {
    log("LLM request:", request);
    return await llmAPI(request, apiUrl, apiKey);
  });

  const llmResults = await Promise.all(llmPromises);
  log("LLM results:", JSON.stringify(llmResults));

  return llmResults.map((res, idx) => {
    if (!res.content?.[0]?.text) {
      throw new Error("Malformed LLM Response");
    }
    const parsed = JSON.parse(res.content[0].text);
    const result = ParsedCompanyDataSchema.safeParse(parsed);
    if (!result.success) {
      log(`LLM output validation failed for message #${idx}: ${result.error.message}`);
      throw new Error(`LLM output validation failed: ${result.error.message}`);
    }
    return parsed;
  });
}

function normalizeCompanyData(parsedData: ParsedCompanyData[]): CompanyUpsertData[] {
  return parsedData.map(json => removeEmptyFields({
    name: json.name,
    industry: json.industry,
    email: json.email,
    phone: json.phone,
    city: json.city,
    state: json.state
  }) as CompanyUpsertData);
}

async function processMessages(companies: CompanyUpsertData[], messages: QueueMessage[], supabase: SupabaseClient<Database>, pgmq_public: SupabaseClient<Database, 'pgmq_public'>) {
  const processPromises = companies.map(async (company, idx) => {
    const result = await upsertCompany(supabase, company);
    const message = messages[idx];
    
    if (!result.success) {
      log("Error upserting company", company.name, ":", result.error);
      await archiveMessage(pgmq_public, message);
    } else {
      log("Successfully upserted", company.name);
      
      // Extract company_id and insert flag from the new return format
      const upsertResult = result.data as unknown as UpsertResult;
      const companyId = upsertResult.company_id;
      const wasInsert = upsertResult.was_insert;
      
      // Update vehicle_photos table with company_id
      const pathname = message.message.image_path;
      const { error: updateError } = await supabase
        .from('vehicle-photos')
        .update({ company_id: companyId })
        .eq('name', pathname);
      
      if (updateError) {
        log("Error updating vehicle_photos with company_id:", updateError);
      } else {
        log("Successfully linked vehicle photo to company");
      }
      
      // Only enqueue for contact enrichment if this was a new company (insert)
      if (wasInsert) {
        try {
          await enqueueForContactEnrichment(pgmq_public, companyId);
          log(`Enqueued new company ${company.name} for contact enrichment`);
        } catch (error) {
          log("Error enqueueing company for contact enrichment:", error);
          // Don't fail the entire process if enqueueing fails
        }
      }
      
      await deleteMessage(pgmq_public, message);
    }
  });

  await Promise.all(processPromises);
}

export const handler = async (req: Request, overrides?: {
    dequeueElement?: typeof dequeueElement,
    callVisionAPI?: typeof callVisionAPI,
    callLLMAPI?: typeof callLLMAPI,
    generateSignedUrls?: typeof generateSignedUrls
}) => {
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

    const dequeue = overrides?.dequeueElement ?? dequeueElement;
    const vision = overrides?.callVisionAPI ?? callVisionAPI;
    const llm = overrides?.callLLMAPI ?? callLLMAPI;
    const url = overrides?.generateSignedUrls ?? generateSignedUrls;

    try {
      const { data: messages } = await dequeue(pgmq_public, CONSTANTS.BATCH_SIZE);
      const { urls: signedUrls, num } = await url(supabase, messages);

      if (num === 0) {
          return new Response(JSON.stringify({ 
              status: 200,
              headers: { 'Content-Type': 'application/json' },
              message: 'No new messages'
          }));
      }

      const ocrRequests = signedUrls!.map(signedUrl => ({
          image: { source: { imageUri: signedUrl.signedUrl } },
          features: [{ type: "TEXT_DETECTION" }]
      }));

      log("Cloud Vision requests:", ocrRequests);
      
      const ocrResponses = await vision(ocrRequests, envVars.VISION_API_URL, envVars.VISION_API_KEY);
      log("OCR results:", ocrResponses);
      
      if (!ocrResponses) {
          throw new Error("Malformed OCR response: no 'responses' field");
      }

      ocrResponses.forEach((res, i) => {
          if (res.error) {
              log(`Error in OCR response #${i}:`, res.error);
          }
      });

      const parsedCompanies = await processOCRWithLLM(
        ocrResponses, 
        llm, 
        envVars.ANTHROPIC_API_URL, 
        envVars.ANTHROPIC_API_KEY
      );

      const normalizedCompanies = normalizeCompanyData(parsedCompanies);
      log("Normalized company data:", normalizedCompanies);

      await processMessages(normalizedCompanies, messages, supabase, pgmq_public);

    } catch (error) {
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


