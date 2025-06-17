// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

// Utility: Get environment variable with error if missing
function getEnvVar(key: string): string {
  // @ts-ignore: Deno global may not be recognized by some linters
  const value = typeof Deno !== 'undefined' && Deno.env && Deno.env.get ? Deno.env.get(key) : undefined;
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

// Utility: Log helper
function log(message: string, ...args: unknown[]) {
  console.log(`[receive-email] ${message}`, ...args);
}

// Utility: Validate file type and size
function validateFile(file: File) {
  const allowedTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (!allowedTypes.includes(file.type)) {
    throw new Error(`Invalid file type: ${file.type}`);
  }
  if (file.size > maxSize) {
    throw new Error(`File too large: ${file.size}`);
  }
}

// Utility: Generate unique filename
function generateUniqueFilename(originalName: string): string {
  const match = originalName.match(/\.([^.\/]+)$/);
  const ext = match ? match[1] : "";
  return `uploads/vehicle_${crypto.randomUUID()}.${ext}`;
}

// Utility: Upload file to Supabase storage
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

// Utility: Enqueue job for worker
async function enqueueImageJob(pgmq_public: any, imagePath: string) {
  const { error } = await pgmq_public.rpc("send", {
    queue_name: "image-processing",
    message: { image_path: imagePath },
  });
  if (error) throw error;
}

// Utility: Trigger worker
async function triggerWorker(url: string, key: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to trigger worker: ${response.status} ${text}`);
  }
}

const SUPABASE_SERVICE_ROLE_KEY = getEnvVar("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_URL = getEnvVar("SUPABASE_URL");
const WORKER_URL = getEnvVar("WORKER_URL");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const pgmq_public = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { db: { schema: "pgmq_public" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  try {
    const formData = await req.formData();
    const file = formData.get("attachment-1");
    if (!file || !(file instanceof File)) {
      log("No attachment found");
      return new Response("No attachment found", { status: 400 });
    }
    validateFile(file);
    const filename = generateUniqueFilename(file.name);
    log(`Uploading file as ${filename}`);
    const uploadData = await uploadFileToStorage(supabase, file, filename);
    log(`File uploaded: ${uploadData.path}`);
    await enqueueImageJob(pgmq_public, uploadData.path);
    log(`Job enqueued for image: ${uploadData.path}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await triggerWorker(WORKER_URL, SUPABASE_SERVICE_ROLE_KEY);
    log(`Worker triggered`);
    return new Response(JSON.stringify({ success: true, path: uploadData.path }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    log(`Error: ${error.message || error}`);
    return new Response(JSON.stringify({ error: error.message || String(error) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/receive-email' \
    --header 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
    --header 'Content-Type: application/json' \
    --data '{"name":"Functions"}'

*/
