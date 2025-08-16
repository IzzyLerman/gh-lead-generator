import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Database } from './../_shared/database.types.ts';
import { createLogger } from './../_shared/logger.ts';
import { getAccessToken } from './../_shared/zohomail-auth.ts';

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
    .select('id, company_id, name, email, email_subject, email_body')
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
    email_body: contactData.email_body
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

async function sendEmail(contact: ContactWithCompany, attachments: AttachmentMetadata[]): Promise<void> {
  logger.debug('Sending email via ZohoMail', { contactId: contact.id, recipientEmail: contact.email });
  
  const accessToken = await getAccessToken();
  const accountId = getEnvVar('ZOHO_MAIL_ACCOUNT_ID');
  const fromAddress = getEnvVar('ZOHO_MAIL_FROM_ADDRESS');
  
  if (!contact.email_subject || !contact.email_body) {
    throw new Error('Email subject and body are required');
  }
  
  const emailData = {
    fromAddress: fromAddress,
    toAddress: contact.email,
    subject: contact.email_subject,
    content: contact.email_body,
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
  try {
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { status: 405, headers: { "Content-Type": "application/json" } }
      );
    }

    const body: SendEmailRequest = await req.json();
    
    if (!body.contact_id) {
      return new Response(
        JSON.stringify({ error: 'contact_id is required' }),
        { status: 400, headers: { "Content-Type": "application/json" } }
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
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    const vehiclePhotos = await getVehiclePhotosByCompanyId(supabase, contact.company_id);
    if (vehiclePhotos.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No vehicle photos found for company' }),
        { status: 404, headers: { "Content-Type": "application/json" } }
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
        { status: 500, headers: { "Content-Type": "application/json" } }
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
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    logger.error('Unhandled error in send-email function', { error: error.message, stack: error.stack });
    
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        message: error.message 
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
