/* Dequeue pgmq messages in batches of 5 and process the correspodnding image with OCR, then upsert the data into the company table.
*/

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { ParsedCompanyDataSchema, ParsedCompanyData } from "./../_shared/schema.ts";

function getEnvVar(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

function log(message: string, ...args: unknown[]) {
  console.log(`[worker] ${message}`, ...args);
}

async function callVisionAPI(imageRequests: any[], url: string, key: string) {
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

async function callLLMAPI(request: any, url: string, key: string) {
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

function normalizeName(name: string): string {
  return name.toLowerCase() 
    .normalize("NFKD")
    .replace(/[^\w\s]/g, "")                        
    .replace(/\b(?:inc|corp|llc|co|ltd|plc)\b/gi, "")
    .trim();                                            
}

function normalizeEmail(email: string): string {
    return email.toLowerCase()
}

function normalizePhone(phone: string): string {
    return phone.replace(/\D/g, "");
}



function removeEmptyFields(obj) {
  const filtered = {};
  
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

const upsertCompany = async (supabase, company) => {
  if (!supabase || !company.name) {
    const errorMessage = "Supabase client and company name are required.";
    log(errorMessage);
    return { data: null, success: false, error: { message: errorMessage } };
  }

  try {
    const { data, error } = await supabase.rpc('upsert_company', {
      p_name: company.name,
      p_email: company.email ? company.email : null,
      p_phone: company.phone ? company.phone : null,
      p_industry: company.industry ? company.industry : [],
      p_city: company.city ? company.city : null,
      p_state: company.state ? company.state : null
    });

    if (error) {
      // Re-throw the error to be caught by the calling try/catch block
      throw(error);
    }

    log(`Successfully upserted company: ${company.name}`);
    return { data, success: true, error:null};

  } catch (error) {
    log(`Error upserting company '${company.name}':`, error.message);
    return { data: null, success: false,  error };
  }
};


const parseOCRPromptHead = `
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
`
const parseOCRPromptFooter = `\n<END OCR OUTPUT>`;

const SUPABASE_URL = getEnvVar('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = getEnvVar('SUPABASE_SERVICE_ROLE_KEY');
const ANTHROPIC_API_KEY = getEnvVar('ANTHROPIC_API_KEY');
const ANTHROPIC_API_URL = getEnvVar('ANTHROPIC_API_URL');
const VISION_API_URL = getEnvVar('VISION_API_URL');
const VISION_API_KEY = getEnvVar('VISION_API_KEY');

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);
const pgmq_public = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  { db: { schema: 'pgmq_public' } }
);

Deno.serve(async (req) => {
    // Max images processed per invocation
    const MAX_ITERS = 100;
    let iters = 0;

    while(iters < MAX_ITERS){
      try {
        const { data: messages, error: readError } = await pgmq_public.rpc('read', {
          queue_name: 'image-processing',
          sleep_seconds: 15,
          n: 5,
        });

        if (readError) {
          throw readError;
        }

        if (messages && messages.length > 0) {
            let signedUrlPromises = [];
            for (const message of messages) {
                signedUrlPromises.push(
                    supabase.storage
                       .from("gh-vehicle-photos")
                       .createSignedUrl(message.message.image_path, 60)
                       .then(({ data, error }) => {
                         if (error) {
                           throw new Error(`Failed to create signed URL for ${message.message.image_path}: ${error.message}`);
                         }
                         return { signedUrl: data.signedUrl, messageId: message.id };
                       })
                )
            }

            const signedUrls = await Promise.all(signedUrlPromises);
            let n = signedUrls.length;
            log(`Processing ${n} messages:`);


            // OCR
            const requests = signedUrls.map(( signedUrl ) => ({
                    image: { source: { imageUri: signedUrl.signedUrl } },
                    features: [{ type: "TEXT_DETECTION" }],
            }));
            log("Cloud Vision Body: ", requests);

            const responses = await callVisionAPI(requests, VISION_API_URL, VISION_API_KEY);
            log("OCR Resuts: ", responses);
            if (!responses) {
                throw new Error("Malformed response: no 'responses' field.");
            }

            responses.forEach((res, i) => {
                if (res.error) {
                    log(`Error in OCR response #${i}:`, res.error);
                }   
            });


            
            // LLM parses OCR
            
            const LLMRequests = responses.map((res, index) => ({
                     model: "claude-3-5-haiku-20241022",
                     max_tokens: 1024,
                     messages: [
                       {
                         role: "user", 
                         content: parseOCRPromptHead + res.textAnnotations[0].description + parseOCRPromptFooter
                       }
                     ]   
                }));


            let LLMPromises = [];
            for (const request of LLMRequests) {
                log("LLM body", request);
                LLMPromises.push(
                    callLLMAPI(request, ANTHROPIC_API_URL, ANTHROPIC_API_KEY)
                    .then(response => {
                        try {
                            return response;
                        } catch (error) {
                            throw new Error(`LLM output validation failed: ${error.message}`);
                        }
                    })
                )
            }

            const LLMResults = await Promise.all(LLMPromises);
            log("LLM Output: " + JSON.stringify(LLMResults));
            const parsedJSONs = await Promise.all(LLMResults.map(async (res, idx) => {
                let parsed = JSON.parse(res.content[0].text);
                let result = ParsedCompanyDataSchema.safeParse(parsed);
                if (result.success) {
                    return parsed;
                }
                log(`LLM output validation failed for message #${idx}: ${result.error.message}`);
                throw new Error(`LLM output validation failed: ${result.error.message}`);
            }));

            normalizedCleanedJSONs = parsedJSONs.map((json) => ( removeEmptyFields({
                name: normalizeName(json.name),
                industry: json.industry,
                email: normalizeEmail(json.email),
                phone: normalizePhone(json.phone),
                city: json.city,
                state: json.state
            })));

            log("normalized/cleaned company JSON: ", normalizedCleanedJSONs); 

            for (const company of normalizedCleanedJSONs) {
                const result = await upsertCompany(supabase,  company);
                if (!result.success) {
                    log("Error upserting company ",company?.name, ": ", result.error);
                }else{
                    log("Successfully upserted ",company?.name);
                }
            }
            


            for (const message of messages) {
                const { error: deleteError } = await pgmq_public.rpc('delete', {
                    queue_name: 'image-processing',
                    message_id: message.msg_id,
                });
                if (deleteError) {
                    log('Error deleting message:', deleteError);
                }
          }
          
          iters += n;

        } else {
            const status = iters < 1 ? 'No new messages' : `Processed ${iters} messages`;
            return new Response(JSON.stringify({ status: status }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }

      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ status: `Processed ${iters} images` }), {
            headers: { 'Content-Type': 'application/json' },
    });


});


