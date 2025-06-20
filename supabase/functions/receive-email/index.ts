/*
 * Receives an HTTP POST from cloud email service containing (max) attachments, uploads them to the bucket, and enqueues a message for the worker
* */


import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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

async function uploadFileToStorage(supabase: any, file: File, filename: string) {
  const { data, error } = await supabase.storage
    .from("gh-vehicle-photos")
    .upload(filename, file, {
      contentType: file.type,
      upsert: true,
    });
  if (error) throw error;
  return data;
}

export async function enqueueImageJob(pgmq_public: any, imagePath: string) {
  const { result } = await pgmq_public.rpc("send", {
    queue_name: "image-processing",
    message: { image_path: imagePath },
  });
  return result;
}


export async function triggerWorker(supabase: any) {
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

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

  const pgmq_public = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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
    const file = formData.get("attachment-1");
    if (!file || !(file instanceof File)) {
      log("No attachment found");
      return new Response(JSON.stringify({ error: "No attachment found" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    validateFile(file);
    const filename = generateUniqueFilename(file.name);
    log(`Uploading file as ${filename}`);
    const uploadData = await uploadFileToStorage(supabase, file, filename);
    log(`File uploaded: ${uploadData.path}`);

    await enqueue(pgmq_public, uploadData.path);
    log(`Job enqueued for image: ${uploadData.path} `);

    return new Response(JSON.stringify({ success: true, path: uploadData.path }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    log(`Error: ${error.message || error}`);
    return new Response(JSON.stringify({ error: error.message || String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

if (typeof Deno === 'undefined' || !Deno.test) {
    // @ts-ignore: Deno.serve is available in the Supabase Edge Runtime
  Deno.serve(handler);
}
