import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { ParsedCompanyOutputSchema, ParsedCompanyOutput } from "./../_shared/schema.ts";

// Utility: Get environment variable with error if missing
function getEnvVar(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

// Utility: Log helper
function log(message: string, ...args: unknown[]) {
  console.log(`[worker] ${message}`, ...args);
}

// Utility: Call Vision API for OCR
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

// Utility: Call LLM API
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

// Utility: Validate LLM output
function validateLLMOutput(json: any) {
  if (!json || typeof json !== 'object') throw new Error('LLM output is not an object');
  const requiredFields = ['name', 'industry', 'email', 'phone', 'city', 'state'];
  for (const field of requiredFields) {
    if (!(field in json)) throw new Error(`Missing field in LLM output: ${field}`);
  }
}

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


Deno.serve(async (req) => {
    // Prevent infinite loops but shouldn't happen
    const MAX_ITERS = 200;
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
            // Create urls for each image in the store
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

           // Check for per-request errors
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
                        if(!response.ok) {
                            throw new Error(`LLM Call failed: ${response.statusText}`);
                        }
                        try{
                            validateLLMOutput(response);
                            return response;
                        }
                        catch (error) {
                            return new Response(JSON.stringify({ error: error.message }), {
                                status: 500,
                                headers: { 'Content-Type': 'application/json' }
                            })
                        }
                    }))
                
            }

            const LLMResults = await Promise.all(LLMPromises);
            log(LLMResults);
            const parsedJSONs = LLMResults.map((res) => JSON.parse(res.content[0].text));

            const companyJSONs = parsedJSONs.map((json) => ({
                name: json.name,
                industry: json.industry,
                email: [json.email],
                phone: [json.phone],
                city: [json.city],
                state: [json.state]
            }));

            log("parsed company JSON: ", companyJSONs);

            const cleanedJSONs = companyJSONs.map((c) => removeEmptyFields(c));
            log("cleaned company JSON: ", cleanedJSONs);


            // Insert info to company table
            const { data, error } = await supabase
                .from('companies')
                .insert(cleanedJSONs);
            

          // If processing is successful, delete the message from the queue
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


/* To invoke locally:

 1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
 2. Make an HTTP request:

 curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/worker' \
  --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
  --header 'Content-Type: application/json' \
  --data '{"name":"Functions"}'

*/
