import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.24.3';

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
}

const CLAUDE_MODEL = 'claude-3-haiku-20240307';
const MAX_TOKENS = 1000;

function getPrimaryIndustry(industries: string[] | null): string {
  if (!industries || industries.length === 0) {
    return 'business';
  }
  return industries[0];
}

function createEmailPrompt(contact: ContactInfo): string {
  const streetName = extractStreetName(contact.photoLocation);
  const primaryIndustry = getPrimaryIndustry(contact.industry);
  const contactName = contact.firstName || contact.name || 'Business Owner';
  const contactTitle = contact.title || 'Owner';
  const companyName = contact.companyName || 'Company Name';

  return `

 "prompt": "You are an expert copywriter specializing in crafting compelling, casual business development emails. 
 Your goal is to generate an email that feels personal and non-spammy, using a real-world sighting as a unique conversation starter.
 \n\n**Context:**\nThe sender, Izzy from Good Hope Advisors, saw a potential client's company truck on a specific street. 
 Izzy took a photo of the truck to include as an attachment. Good Hope Advisors helps business owners with exit planning and selling their businesses, 
 focusing on clients who are ready to sell now or planning for an exit in the next 3-5 years. The email should be a friendly, low-pressure way to initiate contact.

Output Format:**\nReturn your response as a single, valid JSON object using this exact structure, with no additional commentary:
\n{\n  \"subject\": \"subject line here\",\n  \"body\": \"email body here\"\n}"

 \n\n**Input Variables:**\n- ${contactName}: First name of the contact.\n- ${companyName}: The name of the contact's company.\n- ${primaryIndustry}: The prospect's industry (e.g., 'Landscaping', 'Construction').\n- ${streetName}: The streetName where the truck was seen. You should extract the street name. \n\n**Instructions:**\n1.  **Subject Line:** The subject must be exactly: "Saw your truck on ${streetName} (extract the street name)"\n
 2.  **Tone:** Write in a professional yet friendly and conversational tone. Avoid overly formal language or corporate jargon.\n3.  **Email Body - Flow & Content:**\n  Hi ${contactName}} (Use their first name here)

I spotted one of your trucks on ${streetName} earlier today. A sharp-looking fleet is always a good sign.

My firm, Good Hope Advisors, specializes in helping plumbing and contracting owners achieve a successful exit. Seeing your truck prompted me to reach out, as we've had a lot of success working with business owners in the ${primaryIndustry}} sector. Whether you're planning an exit in the near future or 3-5 years down the road, I'm happy to share some insights on what is currently driving valuations.

Would you be open to a brief, no-obligation call next week to discuss your long-term goals?

Best,
Izzy

}`
;
}

function createTextPrompt(contact: ContactInfo): string {
  const streetName = extractStreetName(contact.photoLocation);
  const primaryIndustry = getPrimaryIndustry(contact.industry);
  const contactName = contact.firstName || contact.name || 'Business Owner';
  const contactTitle = contact.title || 'Owner';
  const companyName = contact.companyName || 'Company Name';

  return ` "prompt": "You are an expert copywriter specializing in crafting compelling, casual business outreach text messages. Your goal is to generate an text message that feels personal and non-spammy, using a real-world sighting as a unique conversation starter.\n\n**Context:**\nThe sender, Izzy from Good Hope Advisors, saw a potential client's company truck on a specific street. Izzy took a photo of the truck to include as an attachment. Good Hope Advisors helps business owners with exit planning and selling their businesses, focusing on clients who are ready to sell now or planning for an exit in the next 3-5 years. The email should be a friendly, low-pressure way to initiate contact.

Output Format:**Return the message content as plaintext"
 \n\n**Input Variables:**\n- ${contactName}: First name of the contact.\n
 - ${companyName}: The name of the contact's company.\n-
   ${primaryIndustry}: The prospect's industry (e.g., 'Landscaping', 'Construction').\n- ${streetName}: The streetName where the truck was seen. You should extract the street name. \n\n**Instructions:**\n  **Tone:** Write in a professional yet friendly and conversational tone. Avoid overly formal language or corporate jargon. 
   **Content**: follow this outline roughly, making small changes to make the message sound natural.
Hi (contact's first name),
Spotted your truck on ${streetName} (pic attached). It prompted me to connect.
I'm Izzy with Good Hope Advisors. We help business owners in the ${primaryIndustry} industry prepare for and execute a profitable sale.

Even if an exit is years away, the planning often starts now. I have some insights on what buyers in the space are looking for.

Are you open to a 15-minute call next week?`;
}

function extractStreetName(location: string): string {
  if (!location || location === 'Unknown location') {
    return 'your location';
  }
  
  const parts = location.split(',').map(part => part.trim());
  
  if (parts.length === 0) {
    return 'your location';
  }
  
  const firstPart = parts[0];
  if (!firstPart) {
    return 'your location';
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
    const cleanedResponse = response.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
    const parsed = JSON.parse(cleanedResponse);
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

export async function generateEmail(contact: ContactInfo, apiKey: string, apiUrl?: string): Promise<EmailResult> {
  const prompt = createEmailPrompt(contact);
  const response = await callClaudeAPI(prompt, apiKey);
  return parseEmailResponse(response);
}

export async function generateTextMessage(contact: ContactInfo, apiKey: string, apiUrl?: string): Promise<string> {
  const prompt = createTextPrompt(contact);
  return await callClaudeAPI(prompt, apiKey);
}

export type { ContactInfo, EmailResult };
