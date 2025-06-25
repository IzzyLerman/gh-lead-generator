/*
 * Receives an HTTP POST from cloud email service containing (max) attachments, uploads them to the bucket, and enqueues a message for the worker
* */


import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Database } from './../_shared/database.types.ts'

interface CloudinaryUploadResponse {
  public_id: string;
  version: number;
  signature: string;
  width: number;
  height: number;
  format: string;
  resource_type: string;
  created_at: string;
  tags: string[];
  bytes: number;
  type: string;
  etag: string;
  placeholder: boolean;
  url: string;
  secure_url: string;
  access_mode: string;
  original_filename: string;
}


function getEnvVar(key: string): string {
  // @ts-ignore: Deno global may not be recognized by some linters
  const value = typeof Deno !== 'undefined' && Deno.env && Deno.env.get ? Deno.env.get(key) : undefined;
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

function log(message: string, ...args: unknown[]) {
  console.log(`[receive-email] ${message}`, ...args);
}

async function verifySignature(body: ArrayBuffer, timestamp: string, signature: string, secret: string): Promise<boolean> {
  try {
    const timeLimit = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    const requestTime = parseInt(timestamp) * 1000;
    
    if (now - requestTime > timeLimit) {
      log('Request timestamp too old');
      return false;
    }
    
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const message = new Uint8Array(body.byteLength + timestamp.length);
    message.set(new Uint8Array(body), 0);
    message.set(encoder.encode(timestamp), body.byteLength);
    
    const calculatedSignature = await crypto.subtle.sign('HMAC', key, message);
    const calculatedHex = Array.from(new Uint8Array(calculatedSignature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return calculatedHex === signature;
  } catch (error) {
    log('Signature verification error:', error);
    return false;
  }
}

async function verifyContentBasedSignature(attachments: File[], timestamp: string, signature: string, secret: string): Promise<boolean> {
  try {
    const timeLimit = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    const requestTime = parseInt(timestamp) * 1000;
    
    if (now - requestTime > timeLimit) {
      log('Request timestamp too old');
      return false;
    }
    
    // Recreate the signature payload that matches the Lambda function
    const signaturePayloads: Uint8Array[] = [];
    
    for (const attachment of attachments) {
      // Include filename and content type in signature for security (matching Lambda logic)
      const metaString = `${attachment.name}:${attachment.type}:`;
      const metaBuffer = new TextEncoder().encode(metaString);
      const contentBuffer = new Uint8Array(await attachment.arrayBuffer());
      
      signaturePayloads.push(metaBuffer);
      signaturePayloads.push(contentBuffer);
    }
    
    // Concatenate all payload parts
    const totalLength = signaturePayloads.reduce((sum, arr) => sum + arr.length, 0);
    const signaturePayload = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of signaturePayloads) {
      signaturePayload.set(part, offset);
      offset += part.length;
    }
    
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    // Create message with signature payload + timestamp (matching Lambda logic)
    const message = new Uint8Array(signaturePayload.length + timestamp.length);
    message.set(signaturePayload, 0);
    message.set(encoder.encode(timestamp), signaturePayload.length);
    
    const calculatedSignature = await crypto.subtle.sign('HMAC', key, message);
    const calculatedHex = Array.from(new Uint8Array(calculatedSignature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return calculatedHex === signature;
  } catch (error) {
    log('Content-based signature verification error:', error);
    return false;
  }
}

async function generateSignature(params: Record<string, string | number>, apiSecret: string): Promise<string> {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  
  const encoder = new TextEncoder();
  const data = encoder.encode(sortedParams + apiSecret);
  
  // Use SHA-1 as required by Cloudinary
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function uploadToCloudinary(videoFile: File): Promise<CloudinaryUploadResponse> {
  const CLOUDINARY_CLOUD_NAME = getEnvVar("CLOUDINARY_CLOUD_NAME");
  const CLOUDINARY_API_KEY = getEnvVar("CLOUDINARY_API_KEY");
  const CLOUDINARY_API_SECRET = getEnvVar("CLOUDINARY_API_SECRET");
  
  const timestamp = Math.round(Date.now() / 1000);
  const params = {
    timestamp: timestamp,
  };

  const signature = await generateSignature(params, CLOUDINARY_API_SECRET);

  const formData = new FormData();
  formData.append('file', videoFile);
  formData.append('api_key', CLOUDINARY_API_KEY);
  formData.append('timestamp', timestamp.toString());
  formData.append('signature', signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`,
    {
      method: 'POST',
      body: formData
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudinary upload failed: ${response.status} ${errorText}`);
  }

  return await response.json() as CloudinaryUploadResponse;
}

async function destroyCloudinaryResource(publicId: string, resourceType: 'image' | 'video' = 'video'): Promise<void> {
  try {
    const CLOUDINARY_CLOUD_NAME = getEnvVar("CLOUDINARY_CLOUD_NAME");
    const CLOUDINARY_API_KEY = getEnvVar("CLOUDINARY_API_KEY");
    const CLOUDINARY_API_SECRET = getEnvVar("CLOUDINARY_API_SECRET");
    
    const timestamp = Math.round(Date.now() / 1000);
    const params = {
      public_id: publicId,
      timestamp: timestamp,
    };

    const signature = await generateSignature(params, CLOUDINARY_API_SECRET);

    const formData = new FormData();
    formData.append('public_id', publicId);
    formData.append('timestamp', timestamp.toString());
    formData.append('api_key', CLOUDINARY_API_KEY);
    formData.append('signature', signature);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/destroy`,
      {
        method: 'POST',
        body: formData
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cloudinary destroy failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    log(`Successfully destroyed Cloudinary resource: ${publicId}, result: ${result.result}`);
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Warning: Failed to destroy Cloudinary resource ${publicId}: ${errorMessage}`);
  }
}

function validateFile(file: File) {
  const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "video/mp4", "video/mov"];
  const maxSize = 50 * 1024 * 1024; 
  if (!allowedTypes.includes(file.type)) {
    throw new Error(`Invalid file type: ${file.type}`);
  }
  if (file.size > maxSize) {
    throw new Error(`File too large: ${file.size}`);
  }
}

function generateUniqueFilename(originalName: string): string {
  const match = originalName.match(/\.([^.\/]+)$/);
  const ext = match ? match[1] : "";
  return `uploads/vehicle_${crypto.randomUUID()}.${ext}`;
}

async function convertHeicToJpg(heicFile: File): Promise<File> {
  try {
    const arrayBuffer = await heicFile.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    
    // @ts-ignore: heic-convert doesn't have type definitions
    const convert = (await import('npm:heic-convert@2.1.0')).default;
    
    const jpegBuffer = await convert({
      buffer: uint8Array,
      format: 'JPEG',
      quality: 0.9
    });
    
    const filename = heicFile.name.replace(/\.heic$/i, '.jpg');
    return new File([jpegBuffer], filename, { type: 'image/jpeg' });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error converting HEIC to JPG: ${errorMessage}`);
    throw new Error(`Failed to convert HEIC file ${heicFile.name}: ${errorMessage}`);
  }
}

async function extractVideoFrameFromCloudinary(videoFile: File): Promise<File> {
  try {
    log(`Extracting first frame from video: ${videoFile.name}`);
    const CLOUDINARY_CLOUD_NAME = getEnvVar("CLOUDINARY_CLOUD_NAME");
    
    const uploadResponse = await uploadToCloudinary(videoFile);
    log(`Video uploaded to Cloudinary with public_id: ${uploadResponse.public_id}\n${JSON.stringify(uploadResponse)}`);
    
    const publicId = uploadResponse["public_id"];
    if (!publicId) {
	log(`No public_id field in Cloudinary response: ${uploadResponse}`);
    }
    
    log(`Downloading first frame from image with public_id: ${publicId}`);
    const response = await fetch(`https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/so_1,f_jpg/${publicId}.jpg`);
    
    if (!response.ok) {
      throw new Error(`Failed to download thumbnail: ${response.status} ${response.statusText}`);
    }
    
    const frameBlob = await response.blob();
    
    const filename = videoFile.name.replace(/\.(mp4|mov)$/i, '.jpg');
    const resultFile = new File([frameBlob], filename, { type: 'image/jpeg' });
    
    log(`Successfully extracted frame: ${resultFile.name}, size: ${resultFile.size} bytes`);
    
    // 5. Clean up video from Cloudinary to save storage
    log(`Cleaning up Cloudinary video resource: ${uploadResponse.public_id}`);
    await destroyCloudinaryResource(uploadResponse.public_id, 'video');
    
    return resultFile;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error extracting video frame: ${errorMessage}`);
    throw new Error(`Failed to extract frame from video ${videoFile.name}: ${errorMessage}`);
  }
}

async function processFileForVision(file: File, videoFrameExtractor?: typeof extractVideoFrameFromCloudinary): Promise<File> {
  if (file.type === 'image/heic') {
    log(`Converting HEIC file ${file.name} to JPG`);
    return await convertHeicToJpg(file);
  } else if (file.type === 'video/mp4' || file.type === 'video/mov') {
    log(`Extracting frame from video file ${file.name}`);
    const extractor = videoFrameExtractor ?? extractVideoFrameFromCloudinary;
    return await extractor(file);
  } else {
    return file;
  }
}

async function uploadFileToStorage(supabase: SupabaseClient<Database>, file: File, filename: string) {
  const { data, error } = await supabase.storage
    .from("gh-vehicle-photos")
    .upload(filename, file, {
      contentType: file.type,
      upsert: true,
    });
  if (error) throw error;
  return data;
}

export async function enqueueImageJob(pgmq_public: SupabaseClient<Database, 'pgmq_public'>, imagePath: string): Promise<number[]> {
  const { data } = await pgmq_public.rpc("send", {
    queue_name: "image-processing",
    message: { image_path: imagePath },
  });
  log(`send result: ${JSON.stringify(data)}`);
  if (!data){
	  throw new Error("Failed to upload to the queue");
  }
  return data;
}


export async function triggerWorker(supabase: SupabaseClient<Database>) {
    const { data, error} = await supabase.functions.invoke('worker', {body: {}})
    if (error) {
    throw new Error(`Failed to trigger worker: ${error.message}`);
  }
}

async function processAttachments(
  attachments: File[],
  supabase: SupabaseClient<Database>,
  pgmq_public: SupabaseClient<Database, 'pgmq_public'>,
  enqueue: typeof enqueueImageJob,
  videoFrameExtractor?: typeof extractVideoFrameFromCloudinary
): Promise<Response> {
  if (attachments.length > 5) {
    attachments.splice(5);
  }

  if (attachments.length === 0) {
    log("No attachments found");
    return new Response(JSON.stringify({ error: "No attachments found" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const uploadedPaths: string[] = [];
  const errors: string[] = [];
  
  for (const file of attachments) {
    try {
      validateFile(file);
      const processedFile = await processFileForVision(file, videoFrameExtractor);
      const filename = generateUniqueFilename(processedFile.name);
      log(`Uploading file as ${filename}`);
      const uploadData = await uploadFileToStorage(supabase, processedFile, filename);
      log(`File uploaded: ${uploadData.path}`);
      uploadedPaths.push(uploadData.path);
      
      await enqueue(pgmq_public, uploadData.path);
      log(`Job enqueued for image: ${uploadData.path} `);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log(`Failed to process file ${file.name}: ${errorMessage}`);
      errors.push(`${file.name}: ${errorMessage}`);
    }
  }

  if (uploadedPaths.length === 0) {
    log("No files were successfully processed");
    return new Response(JSON.stringify({ 
      error: "No files could be processed", 
      errors: errors 
    }), { 
      status: 400, 
      headers: { "Content-Type": "application/json" } 
    });
  }

  const response: any = { 
    success: true, 
    paths: uploadedPaths, 
    count: uploadedPaths.length 
  };
  
  if (errors.length > 0) {
    response.warnings = errors;
    response.skipped = errors.length;
  }

  return new Response(JSON.stringify(response), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

export const handler = async (
    req: Request,
    options?: {
        enqueueImageJob?: typeof enqueueImageJob,
        extractVideoFrame?: typeof extractVideoFrameFromCloudinary
    }
) => {

  const enqueue = options?.enqueueImageJob ?? enqueueImageJob
  const videoFrameExtractor = options?.extractVideoFrame


  const SUPABASE_SERVICE_ROLE_KEY = getEnvVar("SUPABASE_SERVICE_ROLE_KEY");
  log(SUPABASE_SERVICE_ROLE_KEY);
  const SUPABASE_URL = getEnvVar("SUPABASE_URL");
  const WORKER_URL = getEnvVar("WORKER_URL");

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

  const pgmq_public = createClient<Database, 'pgmq_public'>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "pgmq_public" },
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  console.log("INCOMING REQUEST HEADERS:", Object.fromEntries(req.headers));

  // WEBHOOK_SECRET is required for security
  const webhookSecret = Deno.env.get("WEBHOOK_SECRET");
  if (!webhookSecret) {
    log('WEBHOOK_SECRET environment variable is required');
    return new Response(JSON.stringify({ error: "Server configuration error" }), { 
      status: 500, 
      headers: { "Content-Type": "application/json" } 
    });
  }

  // Verify HMAC authentication (always required)
  try {
    const timestamp = req.headers.get('X-Timestamp');
    const signature = req.headers.get('X-Signature');
    
    if (!timestamp || !signature) {
      log('Missing authentication headers');
      return new Response(JSON.stringify({ error: "Missing authentication headers" }), { 
        status: 401, 
        headers: { "Content-Type": "application/json" } 
      });
    }
    
    // Parse form data first to extract attachments for content-based signature
    const formData = await req.formData();
    const attachmentEntries = formData.getAll("attachments[]");
    const attachments: File[] = [];
    
    for (const entry of attachmentEntries) {
      if (entry instanceof File) {
        attachments.push(entry);
      }
    }
    
    // Use content-based signature verification instead of FormData body
    const isValid = await verifyContentBasedSignature(attachments, timestamp, signature, webhookSecret);
    
    if (!isValid) {
      log('Invalid signature or timestamp');
      return new Response(JSON.stringify({ error: "Invalid authentication" }), { 
        status: 401, 
        headers: { "Content-Type": "application/json" } 
      });
    }
    
    return await processAttachments(attachments, supabase, pgmq_public, enqueue, videoFrameExtractor);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error: ${errorMessage}`);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  } 
};

if (typeof Deno === 'undefined' || !Deno.test) {
    // @ts-ignore: Deno.serve is available in the Supabase Edge Runtime
  Deno.serve(handler);
}
