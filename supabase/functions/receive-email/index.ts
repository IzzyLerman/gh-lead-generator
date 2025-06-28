/*
 * Receives an HTTP POST from cloud email service containing (max) attachments, uploads them to the bucket, and enqueues a message for the worker
* */


import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import ExifReader from 'https://esm.sh/exifreader@4';
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
    const timeLimit = 30 * 60 * 1000; // 30 minutes
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

async function verifyContentBasedSignature(attachments: File[], senderEmail: string, timestamp: string, signature: string, secret: string): Promise<boolean> {
  try {
    const timeLimit = 30 * 60 * 1000; // 30 minutes
    const now = Date.now();
    const requestTime = parseInt(timestamp) * 1000;
    
    if (now - requestTime > timeLimit) {
      log('Request timestamp too old');
      return false;
    }
    
    // Recreate the signature payload that matches the Lambda function
    const signaturePayloads: Uint8Array[] = [];
    
    // Include sender email in signature payload to match lambda function
    signaturePayloads.push(new TextEncoder().encode(senderEmail));
    
    for (const attachment of attachments) {
      // Normalize MIME type for signature verification consistency
      let normalizedType = attachment.type;
      
      // Handle common cases where MIME detection differs between client and server
      const fileName = attachment.name.toLowerCase();
      if (fileName.endsWith('.heic') || fileName.endsWith('.heif')) {
        normalizedType = 'image/heic';
      } else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
        normalizedType = 'image/jpeg';
      } else if (fileName.endsWith('.png')) {
        normalizedType = 'image/png';
      } else if (fileName.endsWith('.mp4')) {
        normalizedType = 'video/mp4';
      } else if (fileName.endsWith('.mov')) {
        normalizedType = 'video/mov';
      } else if (fileName.endsWith('.tiff') || fileName.endsWith('.tif')) {
        normalizedType = 'image/tiff';
      }
      
      // Include filename and normalized content type in signature for security (matching Lambda logic)
      const metaString = `${attachment.name}:${normalizedType}:`;
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

    await response.json();
    
  } catch (error) {
    // Silently ignore cleanup failures
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
    const CLOUDINARY_CLOUD_NAME = getEnvVar("CLOUDINARY_CLOUD_NAME");
    
    const uploadResponse = await uploadToCloudinary(videoFile);
    
    const publicId = uploadResponse["public_id"];
    
    const response = await fetch(`https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/so_1,f_jpg/${publicId}.jpg`);
    
    if (!response.ok) {
      throw new Error(`Failed to download thumbnail: ${response.status} ${response.statusText}`);
    }
    
    const frameBlob = await response.blob();
    
    const filename = videoFile.name.replace(/\.(mp4|mov)$/i, '.jpg');
    const resultFile = new File([frameBlob], filename, { type: 'image/jpeg' });
    
    
    // 5. Clean up video from Cloudinary to save storage
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
    return await convertHeicToJpg(file);
  } else if (file.type === 'video/mp4' || file.type === 'video/mov') {
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

function convertDMSToDD(dmsArray: any[], direction: string): number {
  // DMS array format: [degrees, minutes, seconds]
  // Values might be fractions like "6/1" or "123/10"
  
  function parseValue(value: any): number {
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string' && value.includes('/')) {
      const [numerator, denominator] = value.split('/').map(Number);
      return denominator ? numerator / denominator : 0;
    }
    return parseFloat(value) || 0;
  }
  
  const degrees = parseValue(dmsArray[0]);
  const minutes = parseValue(dmsArray[1]); 
  const seconds = parseValue(dmsArray[2]);
  
  // Convert to decimal degrees
  let dd = degrees + (minutes / 60) + (seconds / 3600);
  
  // Apply direction (negative for South and West)
  if (direction === 'S' || direction === 'W' || direction === 'South' || direction === 'West') {
    dd = -dd;
  }
  
  return dd;
}

async function extractLocationFromExif(file: File): Promise<string | null> {
  try {
    // Check if file is an image format that can contain EXIF data
    const supportedTypes = ['image/jpeg', 'image/jpg', 'image/tiff', 'image/tif', 'image/heic', 'image/heif'];
    if (!supportedTypes.includes(file.type.toLowerCase())) {
        return null;
    }

    // Read EXIF data using ArrayBuffer approach
    const arrayBuffer = await file.arrayBuffer();
    const tags = ExifReader.load(arrayBuffer, {
      includeUnknown: false,
      expanded: false
    });
    
    
    // Extract GPS coordinates if available
    const gpsLat = tags.GPSLatitude;
    const gpsLatRef = tags.GPSLatitudeRef;
    const gpsLon = tags.GPSLongitude;
    const gpsLonRef = tags.GPSLongitudeRef;
    

    if (gpsLat && gpsLatRef && gpsLon && gpsLonRef) {
      try {
        // Use the pre-processed description values from ExifReader
        const latDescription = gpsLat.description;
        const lonDescription = gpsLon.description;
        const latRef = Array.isArray(gpsLatRef.value) ? gpsLatRef.value[0] : gpsLatRef.value;
        const lonRef = Array.isArray(gpsLonRef.value) ? gpsLonRef.value[0] : gpsLonRef.value;

        if (latDescription && lonDescription && latRef && lonRef) {
          // Parse the decimal degrees from description
          const lat = parseFloat(latDescription);
          const lon = parseFloat(lonDescription);
          

          if (!isNaN(lat) && !isNaN(lon)) {
            // Apply direction (negative for South and West)
            const finalLat = (latRef === 'S' || latRef === 'South') ? -lat : lat;
            const finalLon = (lonRef === 'W' || lonRef === 'West') ? -lon : lon;
            
            const locationString = `${finalLat.toFixed(6)}, ${finalLon.toFixed(6)}`;
            return locationString;
          } else {
            return null;
          }
        } else {
          return null;
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log(`Error processing GPS coordinates from ${file.name || 'unknown file'}: ${errorMessage}`);
        return null;
      }
    } else {
      return null;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error reading EXIF data from ${file.name || 'unknown file'}: ${errorMessage}`);
    return null;
  }
}


async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const geoapifyApiKey = Deno.env.get('GEOAPIFY_API_KEY');
    if (!geoapifyApiKey) {
        return null;
    }

    const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${geoapifyApiKey}`;
    
    // Add timeout and better error handling for network issues
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'SupabaseFunction/1.0'
      }
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    
    if (data.features && data.features.length > 0) {
      const feature = data.features[0];
      const properties = feature.properties;
      
      // Build street address from components
      const addressParts = [];
      if (properties.housenumber) addressParts.push(properties.housenumber);
      if (properties.street) addressParts.push(properties.street);
      if (properties.city) addressParts.push(properties.city);
      if (properties.state) addressParts.push(properties.state);
      if (properties.postcode) addressParts.push(properties.postcode);
      
      const streetAddress = addressParts.join(', ');
      return streetAddress || null;
    } else {
      return null;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error in reverse geocoding: ${errorMessage}`);
    return null;
  }
}

async function uploadFileAndCreateRecord(
  supabase: SupabaseClient<Database>, 
  file: File, 
  filename: string, 
  senderEmail: string,
  reverseGeocoder?: (lat: number, lon: number) => Promise<string | null>,
  gpsCoordinates?: string | null,
  streetAddress?: string | null
) {
  // Upload to storage first
  const uploadData = await uploadFileToStorage(supabase, file, filename);
  
  // Create record in vehicle-photos table with separated GPS and location data
  const { error: insertError } = await supabase
    .from("vehicle-photos")
    .upsert({
      name: uploadData.path,
      submitted_by: senderEmail,
      status: 'unprocessed',
      gps: gpsCoordinates,
      location: streetAddress
    }, {
      onConflict: 'name'
    });
    
  if (insertError) {
    log(`Error inserting vehicle-photos record: ${JSON.stringify(insertError)}`);
    throw new Error(`Failed to insert vehicle-photos record: ${insertError.message || JSON.stringify(insertError)}`);
  }
  
  return uploadData;
}

export async function enqueueImageJob(pgmq_public: SupabaseClient<Database, 'pgmq_public'>, imagePath: string): Promise<number[]> {
  const { data } = await pgmq_public.rpc("send", {
    queue_name: "image-processing",
    message: { image_path: imagePath },
  });
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
  senderEmail: string,
  supabase: SupabaseClient<Database>,
  pgmq_public: SupabaseClient<Database, 'pgmq_public'>,
  enqueue: typeof enqueueImageJob,
  videoFrameExtractor?: typeof extractVideoFrameFromCloudinary,
  reverseGeocoder?: (lat: number, lon: number) => Promise<string | null>
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
      
      // Extract EXIF location from original file BEFORE processing
      const coordinatesString = await extractLocationFromExif(file);
      let streetAddress: string | null = null;
      
      // If we have coordinates, try to get street address
      if (coordinatesString) {
        const coords = coordinatesString.split(', ');
        if (coords.length === 2) {
          const lat = parseFloat(coords[0]);
          const lon = parseFloat(coords[1]);
          
          if (!isNaN(lat) && !isNaN(lon)) {
            try {
              const geocoder = reverseGeocoder || reverseGeocode;
              streetAddress = await geocoder(lat, lon);
            } catch (error) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              log(`Reverse geocoding failed: ${errorMessage}, using coordinates only`);
            }
          }
        }
      }
      
      // Process file for vision (may strip EXIF)
      const processedFile = await processFileForVision(file, videoFrameExtractor);
      const filename = generateUniqueFilename(processedFile.name);
      
      // Upload file with separated GPS and location data
      const uploadData = await uploadFileAndCreateRecord(supabase, processedFile, filename, senderEmail, undefined, coordinatesString, streetAddress);
      uploadedPaths.push(uploadData.path);
      
      await enqueue(pgmq_public, uploadData.path);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
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
        extractVideoFrame?: typeof extractVideoFrameFromCloudinary,
        reverseGeocode?: (lat: number, lon: number) => Promise<string | null>
    }
) => {

  const enqueue = options?.enqueueImageJob ?? enqueueImageJob
  const videoFrameExtractor = options?.extractVideoFrame
  const reverseGeocoder = options?.reverseGeocode


  const SUPABASE_SERVICE_ROLE_KEY = getEnvVar("SUPABASE_SERVICE_ROLE_KEY");
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
    const senderEmail = formData.get("sender_email")?.toString() || 'unknown';
    const attachments: File[] = [];
    
    for (const entry of attachmentEntries) {
      if (entry instanceof File) {
        attachments.push(entry);
      }
    }
    
    // Use content-based signature verification instead of FormData body
    const isValid = await verifyContentBasedSignature(attachments, senderEmail, timestamp, signature, webhookSecret);
    
    if (!isValid) {
      log('Invalid signature or timestamp');
      return new Response(JSON.stringify({ error: "Invalid authentication" }), { 
        status: 401, 
        headers: { "Content-Type": "application/json" } 
      });
    }
    
    return await processAttachments(attachments, senderEmail, supabase, pgmq_public, enqueue, videoFrameExtractor, reverseGeocoder);
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
