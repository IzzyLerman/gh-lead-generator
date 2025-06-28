import { createClient } from "https://esm.sh/@supabase/supabase-js@2.50.1";

export interface TestConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  receiveEmailUrl: string;
  workerUrl: string;
  dashboardUrl: string;
  webhookSecret: string;
}

export function getTestConfig(): TestConfig {
  return {
    supabaseUrl: Deno.env.get("SUPABASE_URL") || "http://127.0.0.1:54321",
    supabaseServiceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
    receiveEmailUrl: Deno.env.get("RECEIVE_EMAIL_URL") || "http://127.0.0.1:54321/functions/v1/receive-email",
    workerUrl: Deno.env.get("WORKER_URL") || "http://127.0.0.1:54321/functions/v1/worker",
    dashboardUrl: Deno.env.get("DASHBOARD_URL") || "http://localhost:3000",
    webhookSecret: Deno.env.get("WEBHOOK_SECRET") || "",
  };
}

export function createTestSupabaseClient() {
  const config = getTestConfig();
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false }
  });
}

interface AttachmentInfo {
  name: string;
  type: string;
  content: Uint8Array;
}

export class TestHttpClient {
  private config: TestConfig;

  constructor() {
    this.config = getTestConfig();
  }

  private async generateHmacSignature(attachments: AttachmentInfo[], senderEmail: string = 'test@example.com'): Promise<{ timestamp: string, signature: string }> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    
    // Recreate the signature payload that matches the receive-email function
    const signaturePayloads: Uint8Array[] = [];
    
    // Include sender email in signature
    const senderEmailBuffer = new TextEncoder().encode(senderEmail);
    signaturePayloads.push(senderEmailBuffer);
    
    for (const attachment of attachments) {
      // Include filename and content type in signature for security (matching Lambda logic)
      const metaString = `${attachment.name}:${attachment.type}:`;
      const metaBuffer = new TextEncoder().encode(metaString);
      const contentBuffer = attachment.content;
      
      signaturePayloads.push(metaBuffer);
      signaturePayloads.push(contentBuffer);
    }
    
    // Concatenate all payload parts
    const signaturePayload = this.concatUint8Arrays(signaturePayloads);
    
    // Create message with signature payload + timestamp (matching receive-email function logic)
    const timestampBuffer = new TextEncoder().encode(timestamp);
    const message = this.concatUint8Arrays([signaturePayload, timestampBuffer]);
    
    // Generate HMAC-SHA256 signature
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(this.config.webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    
    const signatureArrayBuffer = await crypto.subtle.sign("HMAC", key, message);
    const signature = Array.from(new Uint8Array(signatureArrayBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return { timestamp, signature };
  }

  private concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }

  private normalizeFileType(filename: string, originalType: string): string {
    const fileName = filename.toLowerCase();
    if (fileName.endsWith('.heic') || fileName.endsWith('.heif')) {
      return 'image/heic';
    } else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
      return 'image/jpeg';
    } else if (fileName.endsWith('.png')) {
      return 'image/png';
    } else if (fileName.endsWith('.mp4')) {
      return 'video/mp4';
    } else if (fileName.endsWith('.mov')) {
      return 'video/mov';
    } else if (fileName.endsWith('.tiff') || fileName.endsWith('.tif')) {
      return 'image/tiff';
    }
    return originalType;
  }

  async uploadImages(images: File[], senderEmail: string = 'test@example.com'): Promise<Response> {
    // Convert files to attachment info for signature generation
    const attachments: AttachmentInfo[] = [];
    for (const image of images) {
      const content = new Uint8Array(await image.arrayBuffer());
      const normalizedType = this.normalizeFileType(image.name, image.type);
      attachments.push({
        name: image.name,
        type: normalizedType,
        content: content
      });
    }

    // Generate HMAC signature
    const { timestamp, signature } = await this.generateHmacSignature(attachments, senderEmail);

    // Create form data
    const formData = new FormData();
    formData.append('sender_email', senderEmail);
    
    images.forEach((image) => {
      formData.append('attachments[]', image);
    });

    return await fetch(this.config.receiveEmailUrl, {
      method: "POST",
      headers: {
        "X-Timestamp": timestamp,
        "X-Signature": signature,
      },
      body: formData,
    });
  }

  async uploadSingleImage(image: File): Promise<Response> {
    return this.uploadImages([image]);
  }

  async sendMalformedRequest(data: BodyInit): Promise<Response> {
    return await fetch(this.config.receiveEmailUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.supabaseServiceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: data,
    });
  }

  async triggerWorker(): Promise<Response> {
    // Note: In E2E tests, the worker is triggered automatically by database triggers
    // This method is kept for compatibility but may not be needed in automatic mode
    return await fetch(this.config.workerUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.config.supabaseServiceRoleKey}`,
      },
    });
  }

  async checkDashboard(): Promise<Response> {
    return await fetch(`${this.config.dashboardUrl}/api/companies`);
  }
}

export async function createFileFromPath(path: string, filename: string, mimeType: string): Promise<File> {
  const fileData = await Deno.readFile(path);
  const blob = new Blob([fileData], { type: mimeType });
  return new File([blob], filename, { type: mimeType });
}

export async function waitForCondition(
  conditionFn: () => Promise<boolean>,
  timeoutMs: number = 30000,
  intervalMs: number = 1000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    if (await conditionFn()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  return false;
}