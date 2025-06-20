/*
 * Receives an HTTP POST from cloud email service containing (max) attachments, uploads them to the bucket, and enqueues a message for the worker
* */


import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Database } from './../_shared/database.types.ts'
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

function getEnvVar(key: string): string {
  // @ts-ignore: Deno global may not be recognized by some linters
  const value = typeof Deno !== 'undefined' && Deno.env && Deno.env.get ? Deno.env.get(key) : undefined;
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

function log(message: string, ...args: unknown[]) {
  console.log(`[receive-email] ${message}`, ...args);
}

function validateFile(file: File) {
  const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  const maxSize = 10 * 1024 * 1024; // 10MB Max size for Cloud Vision attachments
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

export async function enqueueImageJob(pgmq_public: SupabaseClient<Database, 'pgmq_public'>, imagePath: string) {
  const { data } = await pgmq_public.rpc("send", {
    queue_name: "image-processing",
    message: { image_path: imagePath },
  });
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
        enqueueImageJob?: typeof enqueueImageJob
    }
) => {

  const enqueue = options?.enqueueImageJob ?? enqueueImageJob


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
    
    const attachments: File[] = [];
    for (let i = 1; i <= 5; i++) {
      const file = formData.get(`attachment-${i}`);
      if (file && file instanceof File) {
        attachments.push(file);
      }
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
      const filename = generateUniqueFilename(file.name);
      log(`Uploading file as ${filename}`);
      const uploadData = await uploadFileToStorage(supabase, file, filename);
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
