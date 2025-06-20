import { assertEquals, assert } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Database } from '../_shared/database.types.ts';
import { handler } from "../receive-email/index.ts";

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
        try {
            await fn();
        } finally {
            await supabase.auth.signOut();
        }
    });
}

const SUPABASE_URL = getTestEnvVar("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = getTestEnvVar("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);


function createMockFile(name: string, type: string, size: number): File {
    const buffer = new Uint8Array(size);
    return new File([buffer], name, { type });
}

async function mockEnqueue(pgmq_public: SupabaseClient<Database, 'pgmq_public'>, path: string): Promise<number[] | null> {
    return Promise.resolve([1]);
}

_test("Valid PNG attachment is uploaded to bucket", async () => {
    const file = createMockFile("test-image.png", "image/png", 1 * 1024 * 1024); // 1MB
    const formData = new FormData();
formData.append("attachment-1", file);

    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        body: formData,
    });
    
    let paths: string[] = [];
    try {
        const response = await handler(request, {enqueueImageJob: mockEnqueue});
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
        if (paths.length > 0) {
            await supabase.storage.from("gh-vehicle-photos").remove(paths);
        }
    }
});

_test("Valid JPG attachment is uploaded to bucket", async () => {
    const file = createMockFile("test-image.jpg", "image/jpeg", 2 * 1024 * 1024); // 2MB
    const formData = new FormData();
    formData.append("attachment-1", file);

    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        body: formData,
    });

    let paths: string[] = [];
    try {
        const response = await handler(request, {enqueueImageJob: mockEnqueue});
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
        if (paths.length > 0) {
            await supabase.storage.from("gh-vehicle-photos").remove(paths);
        }
    }
});

_test("Filename with no extension is handled", async () => {
    const file = createMockFile("image-no-ext", "image/png", 1024); // 1KB
    const formData = new FormData();
    formData.append("attachment-1", file);

    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        body: formData,
    });

    let paths: string[] = [];
    try {
        const response = await handler(request, {enqueueImageJob: mockEnqueue});
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
        if (paths.length > 0) {
            await supabase.storage.from("gh-vehicle-photos").remove(paths);
        }
    }
});


_test("Request with no attachments is handled", async () => {
    const formData = new FormData();
    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        body: formData,
    });

    const response = await handler(request, {enqueueImageJob: mockEnqueue});
    const json = await response.json();

    assertEquals(response.status, 400);
    assertEquals(json.error, "No attachments found");
});

_test("Request with invalid-type attachments (.txt) is handled", async () => {
    const file = createMockFile("document.txt", "text/plain", 1024);
    const formData = new FormData();
    formData.append("attachment-1", file);

    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        body: formData,
    });

    const response = await handler(request, {enqueueImageJob: mockEnqueue});
    const json = await response.json();

    assertEquals(response.status, 500);
    assertEquals(json.error, "Invalid file type: text/plain");
});

_test("File too large is handled", async () => {
    const maxSize = 10 * 1024 * 1024;
    const oversize = maxSize + 1;
    const file = createMockFile("oversized-image.png", "image/png", oversize);
    const formData = new FormData();
    formData.append("attachment-1", file);

    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        body: formData,
    });

    const response = await handler(request, {enqueueImageJob: mockEnqueue});
    const json = await response.json();

    assertEquals(response.status, 500);
    assertEquals(json.error, `File too large: ${oversize}`);
});

_test("Request with 5 attachments is processed correctly", async () => {
    const formData = new FormData();
    const paths: string[] = [];
    
    for (let i = 1; i <= 5; i++) {
        const file = createMockFile(`test-image-${i}.png`, "image/png", 1024 * i);
        formData.append(`attachment-${i}`, file);
    }

    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        body: formData,
    });

    try {
        const response = await handler(request, {enqueueImageJob: mockEnqueue});
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
        if (paths.length > 0) {
            await supabase.storage.from("gh-vehicle-photos").remove(paths);
        }
    }
});

_test("Request with 6 attachments processes only first 5", async () => {
    const formData = new FormData();
    const paths: string[] = [];
    
    for (let i = 1; i <= 6; i++) {
        const file = createMockFile(`test-image-${i}.png`, "image/png", 1024 * i);
        formData.append(`attachment-${i}`, file);
    }

    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        body: formData,
    });

    try {
        const response = await handler(request, {enqueueImageJob: mockEnqueue});
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
        if (paths.length > 0) {
            await supabase.storage.from("gh-vehicle-photos").remove(paths);
        }
    }
});
