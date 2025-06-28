import { assertEquals, assert } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Database } from './../_shared/database.types.ts';
import { handler } from "./../receive-email/index.ts";

function getTestEnvVar(key: string): string {
    // @ts-ignore: Deno global may not be recognized
    const value = Deno.env.get(key);
    if (!value) {
        throw new Error(`TESTING ERROR: Missing environment variable ${key}. Make sure your .env file is set up for local testing.`);
    }
    return value;
}

// Test wrapper

function _test(name: string, fn: () => Promise<void>) {
    Deno.test(name, async() => {
        await fn();
    });
}

const SUPABASE_URL = getTestEnvVar("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = getTestEnvVar("SUPABASE_SERVICE_ROLE_KEY");
const WEBHOOK_SECRET = getTestEnvVar("WEBHOOK_SECRET");
const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);


function createMockFile(name: string, type: string, size: number): File {
    const buffer = new Uint8Array(size);
    return new File([buffer], name, { type });
}

function createFormDataWithSender(files: File[], senderEmail: string = 'test@example.com'): FormData {
    const formData = new FormData();
    formData.append("sender_email", senderEmail);
    for (const file of files) {
        formData.append("attachments[]", file);
    }
    return formData;
}

async function generateAuthHeaders(attachments: File[], senderEmail: string = 'test@example.com'): Promise<{timestamp: string, signature: string}> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    
    // Recreate the signature payload that matches the generate-signature.js script
    const signaturePayloads: Uint8Array[] = [];
    
    // Include sender email in signature (matching generate-signature.js logic)
    const senderEmailBuffer = new TextEncoder().encode(senderEmail);
    signaturePayloads.push(senderEmailBuffer);
    
    for (const attachment of attachments) {
        // Normalize MIME type for signature verification consistency (matching receive-email function)
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
        
        // Include filename and normalized content type in signature for security (matching receive-email function logic)
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
    
    // Create message with signature payload + timestamp (matching generate-signature.js function logic)
    const timestampBuffer = new TextEncoder().encode(timestamp);
    const message = new Uint8Array(signaturePayload.length + timestampBuffer.length);
    message.set(signaturePayload, 0);
    message.set(timestampBuffer, signaturePayload.length);
    
    // Generate HMAC-SHA256 signature
    const keyData = new TextEncoder().encode(WEBHOOK_SECRET);
    const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    
    const calculatedSignature = await crypto.subtle.sign('HMAC', key, message);
    const signature = Array.from(new Uint8Array(calculatedSignature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    
    return { timestamp, signature };
}

async function mockEnqueue(pgmq_public: SupabaseClient<Database, 'pgmq_public'>, path: string): Promise<number[]> {
    return Promise.resolve([1]);
}

async function mockExtractVideoFrame(videoFile: File): Promise<File> {
    // Create a mock JPG frame - just a simple buffer to simulate extracted frame
    const mockFrameData = new Uint8Array(1024); // 1KB mock JPG data
    // Add some fake JPG header bytes to make it look like a JPG
    mockFrameData[0] = 0xFF;
    mockFrameData[1] = 0xD8;
    mockFrameData[2] = 0xFF;
    
    const filename = videoFile.name.replace(/\.(mp4|mov)$/i, '_frame.jpg');
    return new File([mockFrameData], filename, { type: 'image/jpeg' });
}

async function mockReverseGeocode(lat: number, lon: number): Promise<string | null> {
    // Return mock street address for testing
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return `${Math.abs(lat).toFixed(0)} Test Street, Mock City, MC ${Math.abs(lon).toFixed(0)}`;
    }
    return null;
}

_test("Valid PNG attachment is uploaded to bucket", async () => {
    const senderEmail = 'test@example.com';
    const file = createMockFile("test-image.png", "image/png", 1 * 1024 * 1024); // 1MB
    const formData = createFormDataWithSender([file], senderEmail);

    const { timestamp, signature } = await generateAuthHeaders([file], senderEmail);
    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        headers: {
            'X-Timestamp': timestamp,
            'X-Signature': signature,
        },
        body: formData,
    });
    
    let paths: string[] = [];
    try {
        const response = await handler(request, {enqueueImageJob: mockEnqueue, reverseGeocode: mockReverseGeocode});
        const json = await response.json();
        paths = json.paths;

        assertEquals(response.status, 200);
        assertEquals(json.success, true);
        assertEquals(json.count, 1);
        assertEquals(json.paths.length, 1);
        assert(paths[0] && paths[0].startsWith("uploads/vehicle_"), "Path should start with the correct prefix");

        const { data: fileData, error: downloadError } = await supabase.storage
            .from("gh-vehicle-photos")
            .download(paths[0]);
        
        assert(downloadError === null, "File should be downloadable from storage");
        assertEquals(fileData!.size, file.size, "Downloaded file size should match original");

    } finally {
        if (paths && paths.length > 0) {
            await supabase.storage.from("gh-vehicle-photos").remove(paths);
        }
    }
});

_test("Valid JPG attachment is uploaded to bucket", async () => {
    const senderEmail = 'test@example.com';
    const file = createMockFile("test-image.jpg", "image/jpeg", 2 * 1024 * 1024); // 2MB
    const formData = createFormDataWithSender([file], senderEmail);

    const { timestamp, signature } = await generateAuthHeaders([file], senderEmail);
    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        headers: {
            'X-Timestamp': timestamp,
            'X-Signature': signature,
        },
        body: formData,
    });

    let paths: string[] = [];
    try {
        const response = await handler(request, {enqueueImageJob: mockEnqueue, reverseGeocode: mockReverseGeocode});
        const json = await response.json();
        paths = json.paths;

        assertEquals(response.status, 200);
        assertEquals(json.success, true);
        assertEquals(json.count, 1);
        assertEquals(json.paths.length, 1);

        const { data: fileData, error: downloadError } = await supabase.storage.from("gh-vehicle-photos").download(paths[0]);
        assert(downloadError === null);
        assertEquals(fileData!.size, file.size);
    } finally {
        if (paths && paths.length > 0) {
            await supabase.storage.from("gh-vehicle-photos").remove(paths);
        }
    }
});

_test("Filename with no extension is handled", async () => {
    const senderEmail = 'test@example.com';
    const file = createMockFile("image-no-ext", "image/png", 1024); // 1KB
    const formData = createFormDataWithSender([file], senderEmail);

    const { timestamp, signature } = await generateAuthHeaders([file], senderEmail);
    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        headers: {
            'X-Timestamp': timestamp,
            'X-Signature': signature,
        },
        body: formData,
    });

    let paths: string[] = [];
    try {
        const response = await handler(request, {enqueueImageJob: mockEnqueue, reverseGeocode: mockReverseGeocode});
        const json = await response.json();
        paths = json.paths;

        assertEquals(response.status, 200);
        assertEquals(json.success, true);
        assertEquals(json.count, 1);
        assertEquals(json.paths.length, 1);
        assert(paths[0] && paths[0].startsWith("uploads/vehicle_"));

        const { data: fileData, error: downloadError } = await supabase.storage.from("gh-vehicle-photos").download(paths[0]);
        assert(downloadError === null);
        assertEquals(fileData!.size, file.size);
    } finally {
        if (paths && paths.length > 0) {
            await supabase.storage.from("gh-vehicle-photos").remove(paths);
        }
    }
});


_test("Request with no attachments is handled", async () => {
    const senderEmail = 'test@example.com';
    const formData = createFormDataWithSender([], senderEmail);
    
    const { timestamp, signature } = await generateAuthHeaders([], senderEmail);
    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        headers: {
            'X-Timestamp': timestamp,
            'X-Signature': signature,
        },
        body: formData,
    });

    const response = await handler(request, {enqueueImageJob: mockEnqueue});
    const json = await response.json();

    assertEquals(response.status, 400);
    assertEquals(json.error, "No attachments found");
});

_test("Request with invalid-type attachments (.txt) is handled", async () => {
    const senderEmail = 'test@example.com';
    const file = createMockFile("document.txt", "text/plain", 1024);
    const formData = createFormDataWithSender([file], senderEmail);

    const { timestamp, signature } = await generateAuthHeaders([file], senderEmail);
    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        headers: {
            'X-Timestamp': timestamp,
            'X-Signature': signature,
        },
        body: formData,
    });

    const response = await handler(request, {enqueueImageJob: mockEnqueue});
    const json = await response.json();

    assertEquals(response.status, 400);
    assertEquals(json.error, "No files could be processed");
    assert(json.errors.includes("document.txt: Invalid file type: text/plain"));
});

_test("File too large is handled", async () => {
    const senderEmail = 'test@example.com';
    const maxSize = 50 * 1024 * 1024;
    const oversize = maxSize + 1;
    const file = createMockFile("oversized-image.png", "image/png", oversize);
    const formData = createFormDataWithSender([file], senderEmail);

    const { timestamp, signature } = await generateAuthHeaders([file], senderEmail);
    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        headers: {
            'X-Timestamp': timestamp,
            'X-Signature': signature,
        },
        body: formData,
    });

    const response = await handler(request, {enqueueImageJob: mockEnqueue});
    const json = await response.json();

    assertEquals(response.status, 400);
    assertEquals(json.error, "No files could be processed");
    assert(json.errors.includes(`oversized-image.png: File too large: ${oversize}`));
});

_test("Request with 5 attachments is processed correctly", async () => {
    const senderEmail = 'test@example.com';
    const paths: string[] = [];
    const files: File[] = [];
    
    for (let i = 0; i < 5; i++) {
        const file = createMockFile(`test-image-${i}.png`, "image/png", 1024 * (i + 1));
        files.push(file);
    }
    
    const formData = createFormDataWithSender(files, senderEmail);

    const { timestamp, signature } = await generateAuthHeaders(files, senderEmail);
    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        headers: {
            'X-Timestamp': timestamp,
            'X-Signature': signature,
        },
        body: formData,
    });

    try {
        const response = await handler(request, {enqueueImageJob: mockEnqueue, reverseGeocode: mockReverseGeocode});
        const json = await response.json();

        assertEquals(response.status, 200);
        assertEquals(json.success, true);
        assertEquals(json.count, 5);
        assertEquals(json.paths.length, 5);
        
        for (const path of json.paths) {
            assert(path.startsWith("uploads/vehicle_"), "Each path should start with correct prefix");
            paths.push(path);
            
            const { data: fileData, error: downloadError } = await supabase.storage
                .from("gh-vehicle-photos")
                .download(path);
            assert(downloadError === null, "Each file should be downloadable from storage");
            assert(fileData !== null, "File data should not be null");
        }
    } finally {
        if (paths && paths.length > 0) {
            await supabase.storage.from("gh-vehicle-photos").remove(paths);
        }
    }
});

_test("Request with 6 attachments processes only first 5", async () => {
    const senderEmail = 'test@example.com';
    const paths: string[] = [];
    const files: File[] = [];
    
    for (let i = 0; i < 6; i++) {
        const file = createMockFile(`test-image-${i}.png`, "image/png", 1024 * (i + 1));
        files.push(file);
    }
    
    const formData = createFormDataWithSender(files, senderEmail);

    const { timestamp, signature } = await generateAuthHeaders(files, senderEmail);
    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        headers: {
            'X-Timestamp': timestamp,
            'X-Signature': signature,
        },
        body: formData,
    });

    try {
        const response = await handler(request, {enqueueImageJob: mockEnqueue, reverseGeocode: mockReverseGeocode});
        const json = await response.json();

        assertEquals(response.status, 200);
        assertEquals(json.success, true);
        assertEquals(json.count, 5);
        assertEquals(json.paths.length, 5);
        
        for (const path of json.paths) {
            assert(path.startsWith("uploads/vehicle_"), "Each path should start with correct prefix");
            paths.push(path);
            
            const { data: fileData, error: downloadError } = await supabase.storage
                .from("gh-vehicle-photos")
                .download(path);
            assert(downloadError === null, "Each file should be downloadable from storage");
            assert(fileData !== null, "File data should not be null");
        }
    } finally {
        if (paths && paths.length > 0) {
            await supabase.storage.from("gh-vehicle-photos").remove(paths);
        }
    }
});

_test("HEIC attachment is converted to JPG and uploaded", async () => {
    const senderEmail = 'test@example.com';
    const heicData = await Deno.readFile("./supabase/functions/tests/img/ex.heic");
    const file = new File([heicData], "ex.heic", { type: "image/heic" });
    const formData = createFormDataWithSender([file], senderEmail);

    const { timestamp, signature } = await generateAuthHeaders([file], senderEmail);
    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        headers: {
            'X-Timestamp': timestamp,
            'X-Signature': signature,
        },
        body: formData,
    });

    let paths: string[] = [];
    try {
        const response = await handler(request, {enqueueImageJob: mockEnqueue, reverseGeocode: mockReverseGeocode});
        const json = await response.json();
        paths = json.paths || [];

        assertEquals(response.status, 200);
        assertEquals(json.success, true);
        assertEquals(json.count, 1);
        assertEquals(json.paths.length, 1);
        assert(paths[0] && paths[0].startsWith("uploads/vehicle_"), "Path should start with the correct prefix");
        assert(paths[0].includes(".jpg"), "Converted file should have .jpg extension");

        const { data: fileData, error: downloadError } = await supabase.storage
            .from("gh-vehicle-photos")
            .download(paths[0]);
        
        assert(downloadError === null, "Converted file should be downloadable from storage");
        assert(fileData !== null, "File data should not be null");
        // Note: The converted file size will be different from original due to HEIC->JPG conversion
    } finally {
        if (paths && paths.length > 0) {
            await supabase.storage.from("gh-vehicle-photos").remove(paths);
        }
    }
});


_test("MP4 video frame extraction works correctly", async () => {
    const senderEmail = 'test@example.com';
    const mp4Data = await Deno.readFile("./supabase/functions/tests/img/big_buck_bunny.mp4");
    const file = new File([mp4Data], "big_buck_bunny.mp4", { type: "video/mp4" });
    const formData = createFormDataWithSender([file], senderEmail);

    const { timestamp, signature } = await generateAuthHeaders([file], senderEmail);
    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        headers: {
            'X-Timestamp': timestamp,
            'X-Signature': signature,
        },
        body: formData,
    });

    let paths: string[] = [];
    try {
        const response = await handler(request, {
            enqueueImageJob: mockEnqueue,
            extractVideoFrame: mockExtractVideoFrame,
            reverseGeocode: mockReverseGeocode
        });
        const json = await response.json();
        paths = json.paths || [];

        assertEquals(response.status, 200);
        assertEquals(json.success, true);
        assertEquals(json.count, 1);
        assertEquals(json.paths.length, 1);
        assert(paths[0] && paths[0].startsWith("uploads/vehicle_"), "Path should start with the correct prefix");
        assert(paths[0].includes(".jpg"), "Extracted frame should have .jpg extension");

        const { data: fileData, error: downloadError } = await supabase.storage
            .from("gh-vehicle-photos")
            .download(paths[0]);
        
        assert(downloadError === null, "Extracted frame should be downloadable from storage");
        assert(fileData !== null, "File data should not be null");
        assert(fileData.size > 0, "Extracted frame should have content");
        
    } finally {
        if (paths && paths.length > 0) {
            await supabase.storage.from("gh-vehicle-photos").remove(paths);
        }
    }
});
