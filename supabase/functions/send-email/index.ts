import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Database } from './../_shared/database.types.ts';
import { createLogger } from './../_shared/logger.ts';
import { getAccessToken } from './../_shared/zohomail-auth.ts';
import { VerifaliaRestClient } from 'verifalia';

function getEnvVar(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

const logger = createLogger('send-email');

interface SendEmailRequest {
  contact_id: string;
}

interface ContactWithCompany {
  id: string;
  company_id: string;
  company_name: string;
  name: string;
  email: string;
  email_subject: string | null;
  email_body: string | null;
  verifalia_email_valid: string | null;
}

interface VehiclePhoto {
  id: number;
  company_id: string;
  name: string;
  location: string;
}

interface ZohoAttachmentResponse {
  status: {
    code: number;
    description: string;
  };
  data: {
    attachmentSize: string;
    storeName: string;
    attachmentName: string;
    attachmentPath: string;
    url: string;
  }[];
}

async function getContactById(supabase: SupabaseClient<Database>, contactId: string): Promise<ContactWithCompany | null> {
  logger.debug('Looking up contact', { contactId });
  
  const { data: contactData, error: contactError } = await supabase
    .from('contacts')
    .select('id, company_id, name, email, email_subject, email_body, verifalia_email_valid')
    .eq('id', contactId)
    .single();

  if (contactError) {
    logger.error('Failed to fetch contact', { contactId, error: contactError.message });
    throw new Error(`Failed to fetch contact: ${contactError.message}`);
  }

  logger.debug('Looking up company name', { companyId: contactData.company_id });
  
  const { data: companyData, error: companyError } = await supabase
    .from('companies')
    .select('name')
    .eq('id', contactData.company_id)
    .single();

  if (companyError) {
    logger.error('Failed to fetch company', { companyId: contactData.company_id, error: companyError.message });
    throw new Error(`Failed to fetch company: ${companyError.message}`);
  }

  return {
    id: contactData.id,
    company_id: contactData.company_id,
    company_name: companyData.name || '',
    name: contactData.name,
    email: contactData.email,
    email_subject: contactData.email_subject,
    email_body: contactData.email_body,
    verifalia_email_valid: contactData.verifalia_email_valid
  };
}

async function getVehiclePhotosByCompanyId(supabase: SupabaseClient<Database>, companyId: string): Promise<VehiclePhoto[]> {
  logger.debug('Looking up vehicle photos', { companyId });
  
  const { data, error } = await supabase
    .from('vehicle-photos')
    .select('id, company_id, name')
    .eq('company_id', companyId)
    .not('location', 'is', null);

  if (error) {
    logger.error('Failed to fetch vehicle photos', { companyId, error: error.message });
    throw new Error(`Failed to fetch vehicle photos: ${error.message}`);
  }

  return data || [];
}

async function downloadImageFromStorage(supabase: SupabaseClient<Database>, imagePath: string): Promise<Blob> {
  logger.debug('Downloading image from storage', { imagePath });
  
  const { data, error } = await supabase.storage
    .from("gh-vehicle-photos")
    .download(imagePath);

  if (error) {
    logger.error('Failed to download image from storage', { imagePath, error: error.message });
    throw new Error(`Failed to download image: ${error.message}`);
  }

  if (!data) {
    logger.error('No data returned from storage download', { imagePath });
    throw new Error('No image data found');
  }

  return data;
}

interface AttachmentMetadata {
  storeName: string;
  attachmentName: string;
  attachmentPath: string;
}

async function uploadAttachments(contactId: string, imageBlob: Blob, filename: string): Promise<AttachmentMetadata[]> {
  logger.debug('Uploading attachment to ZohoMail', { contactId, filename, size: imageBlob.size });
  
  const accessToken = await getAccessToken();
  const accountId = getEnvVar('ZOHO_MAIL_ACCOUNT_ID');
  
  const formData = new FormData();
  formData.append('attach', imageBlob, filename);
  
  const url = `https://mail.zoho.com/api/accounts/${accountId}/messages/attachments?uploadType=multipart&isInline=true`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Zoho-oauthtoken ${accessToken}`
    },
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Failed to upload attachment to ZohoMail', { 
      status: response.status, 
      statusText: response.statusText, 
      error: errorText 
    });
    throw new Error(`Failed to upload attachment: ${response.status} ${errorText}`);
  }

  const result: ZohoAttachmentResponse = await response.json();
  
  if (result.status.code !== 200) {
    logger.error('ZohoMail API returned error', { result });
    throw new Error(`ZohoMail API error: ${result.status.description}`);
  }

  const attachment = result.data[0];
  logger.info('Successfully uploaded attachment to ZohoMail', { 
    contactId, 
    filename, 
    storeName: attachment.storeName
  });
  
  return [{
    storeName: attachment.storeName,
    attachmentName: attachment.attachmentName,
    attachmentPath: attachment.attachmentPath
  }];
}

function convertPlaintextToHtml(plaintext: string): string {
  return `<p>${plaintext.replace(/\r?\n/g, '<br>')}</p>`;
}

async function verifyEmail(supabase: SupabaseClient<Database>, contact: ContactWithCompany): Promise<{ isValid: boolean; status: string }> {
  logger.debug('Verifying email address', { email: contact.email, contactId: contact.id });
  
  // Check if we already have a cached verification result
  if (contact.verifalia_email_valid) {
    const isValid = contact.verifalia_email_valid === 'true';
    const status = isValid ? 'Deliverable (cached)' : 'Not Deliverable (cached)';
    logger.info('Using cached email verification result', { 
      email: contact.email, 
      contactId: contact.id,
      isValid,
      status
    });
    return { isValid, status };
  }
  
  const username = getEnvVar('VERIFALIA_USERNAME');
  const password = getEnvVar('VERIFALIA_PASSWORD');
  
  const verifalia = new VerifaliaRestClient({
    username: username,
    password: password
  });
  
  try {
    // Submit the email for verification (default behavior should wait for completion)
    const result = await verifalia
      .emailValidations
      .submit(contact.email);
    
    logger.debug('Verifalia API response', { 
      email: contact.email, 
      contactId: contact.id, 
      status: result.overview?.status,
      entriesCount: result.entries?.length
    });
    
    if (!result || !result.entries || result.entries.length === 0) {
      throw new Error(`No verification result returned from Verifalia. Status: ${result?.overview?.status || 'Unknown'}`);
    }
    
    const entry = result.entries[0];
    if (!entry || !entry.classification) {
      throw new Error('Invalid verification result structure from Verifalia');
    }
    
    const status = `${entry.classification} (${entry.status || 'Unknown'})`;
    const isValid = entry.classification === 'Deliverable';
    
    // Cache the verification result in the database
    await supabase
      .from('contacts')
      .update({ verifalia_email_valid: isValid ? 'true' : 'false' })
      .eq('id', contact.id);
    
    logger.info('Email verification completed and cached', { 
      email: contact.email, 
      contactId: contact.id,
      status, 
      isValid,
      classification: entry.classification,
      entryStatus: entry.status || 'Unknown'
    });
    
    return { isValid, status };
  } catch (error) {
    logger.error('Failed to verify email with Verifalia', { email: contact.email, contactId: contact.id, error: error.message });
    throw new Error(`Email verification failed: ${error.message}`);
  }
}

async function sendEmail(contact: ContactWithCompany, attachments: AttachmentMetadata[]): Promise<void> {

  const emailSignatureHtml = `
<div>
    Best,
    <br>
</div>
<div>
    <br>
</div>
<div>
    <b>
        Izzy Lerman
    </b>
    <br>
</div>
<div>
    <i>
        Account Executive
    </i>
    <br>
</div>
<div>
    <b>
        Good Hope Advisors | M&amp;A Advising for Contractors
    </b>
    <br>
</div>
<div>
    516.639.0970
    <br>
</div>
<div>
    <span class="colour" style="color:rgb(70, 120, 134)">
        <span class="font" style="font-family:Aptos, sans-serif">
            <span class="size" style="font-size:10pt">
                <u>
                    <a target="_blank" href="http://www.goodhopeadvisors.com/" id="m_-7158102627353948899OWA02eb39b2-308e-6cdc-89b7-66c7eb773cc1" title="http://www.goodhopeadvisors.com" style="color:rgb(70, 120, 134); margin:0px">
                        www.goodhopeadvisors.com
                    </a>
                </u>
            </span>
        </span>
    </span>
    <span class="colour" style="color:rgb(36, 36, 36)">
        <span class="font" style="font-family:Aptos, sans-serif">
            <span class="size" style="font-size:10pt">
                &nbsp;
            </span>
        </span>
    </span>
    <br>
</div>
<div>
    <br>
</div>
<p style="text-align:left; text-indent:0px; margin:0in 0in 0in 0px">
    <span class="highlight" style="background-color: rgb(255, 255, 255); text-align: left; text-indent: 0px; margin: 0in 0in 0in 0px;">
        <span class="highlight" style="background-color:rgb(255, 255, 255)">
            <span class="colour" style="color:rgb(0, 0, 0)">
                <span class="font" style="font-family:&quot;Century Gothic&quot;, sans-serif">
                    <span class="size" style="font-size:13.3333px">
                        <a target="_blank" href="https://www.axial.net/forum/top-25-lower-middle-market-investment-banks-q1-2025/?utm_source=hs_email&amp;utm_medium=email&amp;_hsenc=p2ANqtz-_js5unEraR1rolGnuZNJ4GsBGBR-Ppa35SNxmwk1_S_nuMT6IjnpcaAmRnwi6N48hAtmbW" id="m_-7158102627353948899LPlnk749822" style="margin:0px; background-color:rgb(255, 255, 255); text-align:left">
                            Good Hope named Top 25 M&amp;A Advisor by Axial
                        </a>
                    </span>
                </span>
            </span>
        </span>
        <br>
    </span>
</p>
<div style="text-align:left; text-indent:0px; background-color:rgb(255, 255, 255); margin:0in 0in 0in 0px; font-family:&quot;Century Gothic&quot;, sans-serif; font-size:13.3333px; color:rgb(0, 0, 0)">
    <span class="highlight" style="background-color:rgb(255, 255, 255)">
        <a target="_blank" href="https://www.axial.net/forum/the-top-50-lower-middle-market-industrials-investors-ma-advisors-2025/" id="m_-7158102627353948899OWAc413e24e-d9fa-c524-90be-55abcbeea635" title="https://www.axial.net/forum/the-top-50-lower-middle-market-industrials-investors-ma-advisors-2025/" style="background-color:rgb(255, 255, 255)">
            Good Hope Top 50 Industrials M&amp;A Advisor
        </a>
    </span>
    <br>
</div>
`

  logger.debug('Sending email via ZohoMail', { contactId: contact.id, recipientEmail: contact.email });
  
  const accessToken = await getAccessToken();
  const accountId = getEnvVar('ZOHO_MAIL_ACCOUNT_ID');
  const fromAddress = getEnvVar('ZOHO_MAIL_FROM_ADDRESS');
  
  if (!contact.email_subject || !contact.email_body) {
    throw new Error('Email subject and body are required');
  }
  
  const htmlBody = convertPlaintextToHtml(contact.email_body);
  const emailContent = htmlBody + emailSignatureHtml;
  
  const emailData = {
    fromAddress: fromAddress,
    toAddress: contact.email,
    subject: contact.email_subject,
    content: emailContent,
    attachments: attachments
  };
  
  const url = `https://mail.zoho.com/api/accounts/${accountId}/messages`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Authorization': `Zoho-oauthtoken ${accessToken}`
    },
    body: JSON.stringify(emailData)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Failed to send email via ZohoMail', { 
      status: response.status, 
      statusText: response.statusText, 
      error: errorText,
      contactId: contact.id
    });
    throw new Error(`Failed to send email: ${response.status} ${errorText}`);
  }
  
  const result = await response.json();
  logger.info('Successfully sent email via ZohoMail', { 
    contactId: contact.id, 
    recipientEmail: contact.email,
    result 
  });
}

Deno.serve(async (req) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const body: SendEmailRequest = await req.json();
    
    if (!body.contact_id) {
      return new Response(
        JSON.stringify({ error: 'contact_id is required' }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    logger.info('Processing send email request', { contactId: body.contact_id });

    const supabaseUrl = getEnvVar('SUPABASE_URL');
    const supabaseServiceRoleKey = getEnvVar('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient<Database>(supabaseUrl, supabaseServiceRoleKey);

    const contact = await getContactById(supabase, body.contact_id);
    if (!contact) {
      return new Response(
        JSON.stringify({ error: 'Contact not found' }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Verify email address before proceeding
    const emailVerification = await verifyEmail(supabase, contact);
    if (!emailVerification.isValid) {
      logger.warn('Email verification failed, aborting send', { 
        contactId: contact.id, 
        email: contact.email, 
        verificationStatus: emailVerification.status 
      });
      return new Response(
        JSON.stringify({ 
          error: 'Email verification failed',
          message: `Email address is not deliverable: ${emailVerification.status}`,
          verification_status: emailVerification.status
        }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const vehiclePhotos = await getVehiclePhotosByCompanyId(supabase, contact.company_id);
    if (vehiclePhotos.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No vehicle photos found for company' }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const uploadedAttachments: AttachmentMetadata[] = [];
    
    for (const photo of vehiclePhotos) {
      if (!photo.name) continue;
      
      try {
        const imageBlob = await downloadImageFromStorage(supabase, photo.name);
        const fileExtension = photo.name.split('.').pop() || 'jpg';
        const filename = `${contact.company_name}.${fileExtension}`;
        const attachments = await uploadAttachments(body.contact_id, imageBlob, filename);
        uploadedAttachments.push(...attachments);
      } catch (error) {
        logger.error('Failed to process vehicle photo', { 
          photoId: photo.id, 
          location: photo.location, 
          error: error.message 
        });
      }
    }

    if (uploadedAttachments.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Failed to upload any attachments' }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    await sendEmail(contact, uploadedAttachments);

    logger.info('Successfully sent email', {
      contactId: body.contact_id,
      companyId: contact.company_id,
      recipientEmail: contact.email,
      attachmentCount: uploadedAttachments.length
    });

    return new Response(
      JSON.stringify({
        success: true,
        contact_id: body.contact_id,
        company_id: contact.company_id,
        recipient_email: contact.email,
        email_sent: true,
        attachments_uploaded: uploadedAttachments.length
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error) {
    logger.error('Unhandled error in send-email function', { error: error.message, stack: error.stack });
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
