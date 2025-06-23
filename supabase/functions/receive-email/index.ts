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

function validateFile(file: File) {
  const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "video/mp4"];
  const maxSize = 50 * 1024 * 1024; // 50MB Max size to accommodate video files
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
    
    // 1. Upload video to Cloudinary
    const uploadResponse = await uploadToCloudinary(videoFile);
    log(`Video uploaded to Cloudinary with public_id: ${uploadResponse.public_id}\n${JSON.stringify(uploadResponse)}`);
    
    // 2. Generate first frame thumbnail URL (so_0 = start offset 0 seconds)
    const publicId = uploadResponse["public_id"];
    if (!publicId) {
	log(`No public_id field in Cloudinary response: ${uploadResponse}`);
    }
    
    // 3. Download the thumbnail
    log(`Downloading first frame from image with public_id: ${publicId}`);
    const response = await fetch(`https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/so_2.5,f_jpg/${publicId}.jpg`);
    
    if (!response.ok) {
      throw new Error(`Failed to download thumbnail: ${response.status} ${response.statusText}`);
    }
    
    const frameBlob = await response.blob();
    
    // 4. Convert to File with proper naming
    const filename = videoFile.name.replace(/\.mp4$/i, '.jpg');
    const resultFile = new File([frameBlob], filename, { type: 'image/jpeg' });
    
    log(`Successfully extracted frame: ${resultFile.name}, size: ${resultFile.size} bytes`);
    
    // 5. Optional: Clean up video from Cloudinary to save storage
    // Note: We could delete the video after extracting the frame
    // For now, leaving it for debugging purposes
    
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
  } else if (file.type === 'video/mp4') {
    log(`Extracting frame from MP4 file ${file.name}`);
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
  try {
    const formData = await req.formData();
        
    const attachmentEntries = formData.getAll("attachments[]");
    const attachments: File[] = [];
    
    for (const entry of attachmentEntries) {
      if (entry instanceof File) {
        attachments.push(entry);
      }
    }
    
    if (attachments.length > 5) {
      attachments.splice(5);
    }

    if (attachments.length === 0) {
      log("No attachments found");
      return new Response(JSON.stringify({ error: "No attachments found" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    if (attachments.length > 5) {
      log(`Too many attachments: ${attachments.length}`);
      return new Response(JSON.stringify({ error: "Maximum 5 attachments allowed" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const uploadedPaths: string[] = [];
    
    for (const file of attachments) {
      validateFile(file);
      const processedFile = await processFileForVision(file, videoFrameExtractor);
      const filename = generateUniqueFilename(processedFile.name);
      log(`Uploading file as ${filename}`);
      const uploadData = await uploadFileToStorage(supabase, processedFile, filename);
      log(`File uploaded: ${uploadData.path}`);
      uploadedPaths.push(uploadData.path);
      
      await enqueue(pgmq_public, uploadData.path);
      log(`Job enqueued for image: ${uploadData.path} `);
    }

    return new Response(JSON.stringify({ success: true, paths: uploadedPaths, count: attachments.length }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
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
