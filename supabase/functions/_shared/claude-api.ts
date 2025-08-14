import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.24.3';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getNaicsIndustries } from './naics-mapper.ts';
import { createLogger } from './logger.ts';
import type { Database } from './database.types.ts';

interface EmailResult {
  subject: string;
  body: string;
}

interface ContactInfo {
  name: string | null;
  firstName: string | null;
  title: string | null;
  companyName: string;
  industry: string[] | null;
  photoLocation: string;
  company_id?: string;
}

const CLAUDE_MODEL = 'claude-3-haiku-20240307';
const MAX_TOKENS = 1000;

async function getPrimaryIndustry(
  contact: ContactInfo,
  supabaseUrl: string,
  supabaseKey: string
): Promise<string> {
  if (contact.company_id) {
    try {
      const supabase = createClient<Database>(supabaseUrl, supabaseKey);
      
      const { data: company, error } = await supabase
        .from('companies')
        .select('primary_industry')
        .eq('id', contact.company_id)
        .single();
      
      if (!error && company?.primary_industry) {
        return company.primary_industry;
      }
    } catch (error) {
      console.error('Failed to get primary industry, falling back to legacy industry:', error);
    }
  }
  
  if (!contact.industry || contact.industry.length === 0) {
    return 'business';
  }
  return contact.industry[0];
}

async function createEmailPrompt(
  contact: ContactInfo,
  supabaseUrl: string,
  supabaseKey: string
): Promise<string> {
  const logger = createLogger('claude-api');
  
  const streetName = extractStreetName(contact.photoLocation);
  const primaryIndustry = await getPrimaryIndustry(contact, supabaseUrl, supabaseKey);
  const contactName = contact.firstName || contact.name || 'Business Owner';
  const contactTitle = contact.title || 'Owner';
  const companyName = contact.companyName || 'Company Name';

  logger.info('Creating email prompt with variables', {
    contactName,
    companyName,
    primaryIndustry,
    streetName,
    company_id: contact.company_id
  });

  return `

 You are an expert copywriter specializing in crafting compelling, casual business development emails. 
 Your goal is to generate an email that feels personal and non-spammy, using a real-world sighting as a unique conversation starter.
 \n\n**Context:**\nThe sender, Izzy from Good Hope Advisors, saw a potential client's company truck on a specific street.
 Izzy took a photo of the truck to include as an attachment. Good Hope Advisors helps business owners with exit planning and selling their businesses, 
 focusing on clients who are ready to sell now or planning for an exit in the next 3-5 years. The email should be a friendly, low-pressure way to initiate contact.

Output Format:**\nReturn your response as a single, valid JSON object using this exact structure, with no additional commentary:
\n{\n  \"subject\": \"subject line here\",\n  \"body\": \"email body here\"\n}"

 \n\n**Input Variables:**\n- ${contactName}: First name of the contact.
     \n- ${companyName}: The name of the contact's company.
     \n- ${primaryIndustry}: The prospect's industry (e.g., 'Landscaping', 'Construction'). If the industry is something like "Plumbing Contractors", reformat it to fit more naturally 
 into the email body. It should also be lowercase if it doesnt start the sentence, for example "we help owners in the plumbing industry" instead of "we help owners in the Plumbing Contractors industry"     \n- ${streetName}: The streetName where the truck was seen. If no street name is provided, you should just skip it - use "Saw your truck yesterday" for the subject instead.
     \n\n**Instructions:**\n1.  

**Subject Line:** The subject depends on whether a street name is provided. 
If it is, it must be exactly: "Saw your truck on ${streetName}"\n
If the streetName is blank or an empty string, it should say "Saw your truck yesterday"
 2.  **Tone:** Write in a professional yet friendly and conversational tone. Avoid overly formal language or corporate jargon. Follow the provided email script roughly,
 making changes to make the email sound more natural. For example, if the primaryIndustry is "Roofing Contractors", you should extract roofing and only write "Roofing Industry".
    \n3.  **Email Body - Flow & Content:**
Hi ${contactName},

I spotted one of your trucks on ${streetName} earlier today (pic attached). A sharp-looking fleet is always a good sign. 
My firm, Good Hope Advisors, specializes in helping owners in the ${primaryIndustry} industry achieve a successful exit. 
Whether you're planning an exit in the near future or 3-5 years down the road, I'm happy to share some insights on what is currently driving valuations.

Would you be open to a brief, no-obligation call next week to discuss your long-term goals?

Best,
Izzy

}`
;
}

async function createTextPrompt(
  contact: ContactInfo,
  supabaseUrl: string,
  supabaseKey: string
): Promise<string> {
  const logger = createLogger('claude-api');
  
  const streetName = extractStreetName(contact.photoLocation);
  const primaryIndustry = await getPrimaryIndustry(contact, supabaseUrl, supabaseKey);
  const contactName = contact.firstName || contact.name || 'Business Owner';
  const contactTitle = contact.title || 'Owner';
  const companyName = contact.companyName || 'Company Name';

  logger.info('Creating text prompt with variables', {
    contactName,
    companyName,
    primaryIndustry,
    streetName,
    company_id: contact.company_id
  });

  return `You are an expert copywriter specializing in crafting compelling, casual business outreach text messages. 
      Your goal is to generate an text message that feels personal and non-spammy, using a real-world sighting as a unique conversation starter.\n\n
  **Context:**\nThe sender, Izzy from Good Hope Advisors, saw a potential client's company truck on a specific street.
      Izzy took a photo of the truck to include as an attachment. Good Hope Advisors helps business owners with exit planning and selling their businesses, focusing on clients who are ready to sell now or planning for an exit in the next 3-5 years. The email should be a friendly, low-pressure way to initiate contact.

Output Format:**Return ONLY the text message content as plaintext with no extra formatting or notes"
 \n\n**Input Variables:**\n- ${contactName}: First name of the contact.\n
 - ${companyName}: The name of the contact's company.\n-
   ${primaryIndustry}: The prospect's industry (e.g., 'Landscaping', 'Construction'). If the industry is something like "Plumbing Contractors", reformat it to fit more naturally 
 into the email body. It should also be lowercase if it doesnt start the sentence, for example "we help owners in the plumbing industry" instead of "we help owners in the Plumbing Contractors industry"   \n- ${streetName}: The streetName where the truck was seen.  \n\n**Instructions:**\n  **Tone:** Write in a professional yet friendly and conversational tone. Avoid overly formal language or corporate jargon. 
   **Content**: Follow the provided email script roughly, making changes to make the message sound natural. Keep it concise (3-5 sentences maximum).
** text script **
Hi ${contactName},
Spotted your truck on ${streetName} (pic attached). A sharp looking fleet is always a good sign.
I'm Izzy with Good Hope Advisors. We help business owners in the ${primaryIndustry} industry prepare for and execute a profitable sale.

Even if an exit is years away, the planning often starts now. I have some insights on what buyers in the space are looking for.

Are you open to a 15-minute call next week?`;
}

function extractStreetName(location: string): string {
  if (!location || location === 'Unknown location') {
    return '';
  }
  
  const parts = location.split(',').map(part => part.trim());
  
  if (parts.length === 0) {
    return '';
  }
  
  const firstPart = parts[0];
  if (!firstPart) {
    return '';
  }
  
  const isEntirelyNumeric = /^\d+$/.test(firstPart);
  
  if (isEntirelyNumeric && parts.length > 1 && parts[1]) {
    return parts[1];
  }
  
  return firstPart;
}

async function callClaudeAPI(prompt: string, apiKey: string, apiUrl?: string): Promise<string> {
  const anthropic = new Anthropic({
    apiKey: apiKey,
  });

  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: MAX_TOKENS,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  });

  if (!response.content || response.content.length === 0) {
    throw new Error('Claude API returned empty content');
  }

  const textBlock = response.content.find(block => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('Claude API did not return text content');
  }

  return textBlock.text;
}

function parseEmailResponse(response: string): EmailResult {
  try {
    const trimmedResponse = response.trim();
    
    const sanitizedResponse = trimmedResponse;
    /*  .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    */

    const parsed = JSON.parse(sanitizedResponse);
    if (!parsed.subject || !parsed.body) {
      throw new Error('Missing subject or body in JSON response');
    }
    return {
      subject: parsed.subject,
      body: parsed.body
    };
  } catch (error) {
    throw new Error(`Could not parse JSON response from Claude API: ${error instanceof Error ? error.message : String(error)}. Response: ${response.substring(0, 200)}`);
  }
}

export async function generateEmail(
  contact: ContactInfo,
  apiKey: string,
  supabaseUrl: string,
  supabaseKey: string,
  apiUrl?: string
): Promise<EmailResult> {
  const logger = createLogger('claude-api');
  const prompt = await createEmailPrompt(contact, supabaseUrl, supabaseKey);
  const response = await callClaudeAPI(prompt, apiKey);
  
  logger.info('Raw LLM response for email generation', {
    contactName: contact.firstName || contact.name,
    responseLength: response.length,
    rawResponse: response
  });
  
  return parseEmailResponse(response);
}

export async function generateTextMessage(
  contact: ContactInfo,
  apiKey: string,
  supabaseUrl: string,
  supabaseKey: string,
  apiUrl?: string
): Promise<string> {
  const logger = createLogger('claude-api');
  const prompt = await createTextPrompt(contact, supabaseUrl, supabaseKey);
  const response = await callClaudeAPI(prompt, apiKey);
  
  logger.info('Raw LLM response for text message generation', {
    contactName: contact.firstName || contact.name,
    responseLength: response.length,
    rawResponse: response
  });
  
  return response;
}

export type { ContactInfo, EmailResult };
