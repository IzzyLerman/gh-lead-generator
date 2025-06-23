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
    
    const filename = videoFile.name.replace(/\.mp4$/i, '_frame.jpg');
    return new File([mockFrameData], filename, { type: 'image/jpeg' });
}

_test("Valid PNG attachment is uploaded to bucket", async () => {
    const file = createMockFile("test-image.png", "image/png", 1 * 1024 * 1024); // 1MB
    const formData = new FormData();
formData.append("attachments[]", file);

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
    formData.append("attachments[]", file);

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
    formData.append("attachments[]", file);

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
    formData.append("attachments[]", file);

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
    const maxSize = 50 * 1024 * 1024;
    const oversize = maxSize + 1;
    const file = createMockFile("oversized-image.png", "image/png", oversize);
    const formData = new FormData();
    formData.append("attachments[]", file);

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
    
    for (let i = 0; i < 5; i++) {
        const file = createMockFile(`test-image-${i}.png`, "image/png", 1024 * (i + 1));
        formData.append("attachments[]", file);
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
    
    for (let i = 0; i < 6; i++) {
        const file = createMockFile(`test-image-${i}.png`, "image/png", 1024 * (i + 1));
        formData.append("attachments[]", file);
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

_test("HEIC attachment is converted to JPG and uploaded", async () => {
    const heicData = await Deno.readFile("./supabase/functions/tests/img/ex.heic");
    const file = new File([heicData], "ex.heic", { type: "image/heic" });
    const formData = new FormData();
    formData.append("attachments[]", file);

    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        body: formData,
    });

    let paths: string[] = [];
    try {
        const response = await handler(request, {enqueueImageJob: mockEnqueue});
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
    const mp4Data = await Deno.readFile("./supabase/functions/tests/img/big_buck_bunny.mp4");
    const file = new File([mp4Data], "big_buck_bunny.mp4", { type: "video/mp4" });
    const formData = new FormData();
    formData.append("attachments[]", file);

    const request = new Request("https://fake-url.com/receive-email", {
        method: "POST",
        body: formData,
    });

    let paths: string[] = [];
    try {
        const response = await handler(request, {
            enqueueImageJob: mockEnqueue,
            extractVideoFrame: mockExtractVideoFrame
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
