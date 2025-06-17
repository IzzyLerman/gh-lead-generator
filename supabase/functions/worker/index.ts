import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { ParsedCompanyOutputSchema, ParsedCompanyOutput } from "./../_shared/schema.ts";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const pgmq_public = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { db: { schema: 'pgmq_public' } }
);

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')!;
const ANTHROPIC_API_URL = Deno.env.get('ANTHROPIC_API_URL')!;
const VISION_API_URL = Deno.env.get("VISION_API_URL")!;
const VISION_API_KEY = Deno.env.get("VISION_API_KEY")!;

const parseOCRPromptHead = `
The following is the result of OCR on an image of a company vehicle. Parse the information in the vehicle into the following JSON format.

!!IMPORTANT!! Only use information from the image. If a field is not represented in the ocr output, write a blank string (or empty list if its the industry field). !!ALSO IMPORTANT!! Formatting the output correctly is of utmost importance. Only return the raw JSON as your response. it should look like this:

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
                           throw new Error(`Failed to create signed URL for ${imagePath}: ${error.message}`);
                         }
                         return { signedUrl: data.signedUrl, messageId: message.id };
                       })
                )
            }

            const signedUrls = await Promise.all(signedUrlPromises);
            let n = signedUrls.length;

            console.log(`Processing ${n} messages:`);

            const requests = signedUrls.map(( signedUrl ) => ({
                    image: { source: { imageUri: signedUrl.signedUrl } },
                    features: [{ type: "TEXT_DETECTION" }],
            }));

            console.log("Cloud Vision Body: ", requests);

            // OCR 

            const response = await fetch(`${VISION_API_URL}?key=${VISION_API_KEY}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  requests: requests,
                }),
              }
            );


            const {responses} = await response.json();
           // console.log("OCR Resuts: ", responses);

            // LLM parses OCR
            //
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
                console.log("LLM body", request);
                LLMPromises.push(
                    fetch(ANTHROPIC_API_URL, {
                     method: 'POST',
                     headers: {
                       'Content-Type': 'application/json',
                       'x-api-key': ANTHROPIC_API_KEY,
                       'anthropic-version': '2023-06-01'
                     },
                     body: JSON.stringify(request)

                    })
                .then(response => {
                        if(!response.ok) {
                            throw new Error(`LLM Call failed: ${response.statusText}`);
                        }
                        try{
                            //let output = response.json()
                            //console.log(JSON.stringify(output))
                            return response.json();
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
            console.log(LLMResults);
            const parsedJSONs = LLMResults.map((res) => JSON.parse(res.content[0].text));

            const companyJSONs = parsedJSONs.map((json) => ({
                name: json.name,
                industry: json.industry,
                email: [json.email],
                phone: [json.phone],
                city: [json.city],
                state: [json.state]
            }));

            console.log("parsed company JSON: ", companyJSONs);

            const cleanedJSONs = companyJSONs.map((c) => removeEmptyFields(c));
            console.log("cleaned company JSON: ", cleanedJSONs);


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
                    console.error('Error deleting message:', deleteError);
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
