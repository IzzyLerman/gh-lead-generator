

import { assertEquals, assert } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Database } from '../_shared/database.types.ts';
import { handler, removeEmptyFields, upsertCompany, processOCRWithLLM } from "../worker/index.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY);


// make a mockDequeue function that returns a response containing n messages
function generateMockDequeue(n: number) {
  return async (supabase: SupabaseClient<Database, 'pgmq_public'>, _n: number) => {
    const range = Array.from({ length: n }, (_, i) => i);
    return {
      data: range.map(i => ({
        id: i,
        msg_id: i,
        message: { image_path: "test" }
      })),
      error: null
    }
  };
}

function generateMockVisionAPICall(n: number) {
    return async (req: any[], url: string, key: string) => {
        const range = Array.from({length: n}, (_, i) => i);
        return Promise.resolve(range.map(i => ({
            "textAnnotations": [
                {"description": "test vision output"}
            ],
            "error": null
        })));
    };
}

function generateMockGenerateSignedUrls(n: number) {
  return async (supabase: SupabaseClient<Database>, messages: any[]) => {
    const range = Array.from({ length: n }, (_, i) => i);
    return {
        urls: range.map(i => ({
          signedUrl: "test-url-" + i,
          messageId: i,
        })),
        num: n
    };
  };
}

const mockLLMAPICall = async (req: any, url: string, key: string) => {
    return Promise.resolve({
            "content": [{
                "text": "test LLM response",
                "type" : "text"
                }
            ]
        });
}

function _test(name: string, fn: () => Promise<void>) {
    Deno.test(name, async() => {
        try {
            await fn();
        } finally {
            await supabase.auth.signOut();
        }
    });
}

_test("Empty queue is handled properly", async () => {
    const mockDequeue = generateMockDequeue(0);
    const mockVision = generateMockVisionAPICall(0);
    const mockUrl = generateMockGenerateSignedUrls(0);


    const response = await handler(new Request("http://localhost/worker"), {
        "dequeueElement": mockDequeue,
        "callVisionAPI": mockVision,
        "callLLMAPI": mockLLMAPICall,
        "generateSignedUrls": mockUrl
    });

    const body = await response.json()
    assertEquals(response.status, 200);
    assertEquals(body.message, 'No new messages');
});

_test("Dequeue returns an error", async () => {
    const mockDequeue = async() => { throw new Error("Failed to dequeue"); }
    const mockVision = generateMockVisionAPICall(1);
    const mockUrl = generateMockGenerateSignedUrls(1);

    const response = await handler(new Request("http://localhost/worker"), {
        "dequeueElement": mockDequeue,
        "callVisionAPI": mockVision,
        "callLLMAPI": mockLLMAPICall,
        "generateSignedUrls": mockUrl
    });

    const body = await response.json();
    assertEquals(response.status, 500);
    assert(body.error.includes('Failed to dequeue'));
});

_test("Generate signed URLs returns an error", async () => {
    const mockDequeue = generateMockDequeue(1);
    const mockVision = generateMockVisionAPICall(1);
    const mockUrl = async() => { throw new Error('Failed to create signed URL'); }
    const response = await handler(new Request("http://localhost/worker"), {
        "dequeueElement": mockDequeue,
        "callVisionAPI": mockVision,
        "callLLMAPI": mockLLMAPICall,
        "generateSignedUrls": mockUrl
    });

    const body = await response.json();
    assertEquals(response.status, 500);
    assert(body.error.includes( 'Failed to create signed URL'));
});


_test("Vision API call fails", async () => {
    const mockDequeue = generateMockDequeue(1);
    const mockUrl = generateMockGenerateSignedUrls(1);
    const mockVision = async() => { throw new Error("Vision API is down"); }

    const response = await handler(new Request("http://localhost/worker"), {
        "dequeueElement": mockDequeue,
        "callVisionAPI": mockVision,
        "callLLMAPI": mockLLMAPICall,
        "generateSignedUrls": mockUrl
    });

    const body = await response.json();
    assertEquals(response.status, 500);
    assert(body.error.includes( 'Vision API is down'));

});


_test("LLM API call fails", async () => {
    const mockDequeue = generateMockDequeue(1);
    const mockUrl = generateMockGenerateSignedUrls(1);
    const mockVision = generateMockVisionAPICall(1);
    const mockLLM = async () => { throw new Error("LLM is unavailable"); }

    const response = await handler(new Request("http://localhost/worker"), {
        "dequeueElement": mockDequeue,
        "callVisionAPI": mockVision,
        "callLLMAPI": mockLLM,
        "generateSignedUrls": mockUrl
    });

    const body = await response.json();
    assertEquals(response.status, 500);
    assert(body.error.includes( 'LLM is unavailable'));
});

_test("LLM returns malformed JSON", async () => {
    const mockDequeue = generateMockDequeue(1);
    const mockUrl = generateMockGenerateSignedUrls(1);
    const mockVision = generateMockVisionAPICall(1);
    const mockLLM = async () => { return Promise.resolve("lmao" as any); }

    const response = await handler(new Request("http://localhost/worker"), {
        "dequeueElement": mockDequeue,
        "callVisionAPI": mockVision,
        "callLLMAPI": mockLLM,
        "generateSignedUrls": mockUrl
    });
    const body = await response.json();
    assertEquals(response.status, 500);
    assert(body.error.includes( 'Malformed LLM Response'));
});


_test("LLM returns valid JSON with missing fields (fails validation)", async () => {
    const mockDequeue = generateMockDequeue(1);
    const mockUrl = generateMockGenerateSignedUrls(1);
    const mockVision = generateMockVisionAPICall(1);
    // 'name' is required by the schema
    const mockLLM = async (req: any, url: string, key: string) => {
        return Promise.resolve({
            "content": [{
                "text": JSON.stringify({
                    "industry":["heating"]
                }),
                "type" : "text"
            }]
        });
    }

    const response = await handler(new Request("http://localhost/worker"), {
        "dequeueElement": mockDequeue,
        "callVisionAPI": mockVision,
        "callLLMAPI": mockLLM,
        "generateSignedUrls": mockUrl
    });
    const body = await response.json();
    assertEquals(response.status, 500);
    assert(body.error.includes( 'LLM output validation failed'));

});


_test("removeEmptyFields removes empty strings and null values", async () => {
    const input = { 
        name: "ACME", 
        email: "", 
        phone: null, 
        industry: ["heating", ""], 
        city: "Boston",
        state: undefined,
        website: "acme.com"
    };
    const result = removeEmptyFields(input);
    assertEquals(result, { 
        name: "ACME", 
        industry: ["heating"], 
        city: "Boston",
        website: "acme.com"
    });
});

_test("removeEmptyFields handles empty arrays", async () => {
    const input = { name: "Test", industry: ["", ""], tags: [] };
    const result = removeEmptyFields(input);
    assertEquals(result, { name: "Test" });
});

_test("processOCRWithLLM handles OCR responses without text", async () => {
    const ocrResponses = [{ error: null }]; // Missing textAnnotations
    const mockLLM = async () => ({ content: [{ text: '{"name":"test"}', type: "text" }] });
    
    try {
        await processOCRWithLLM(ocrResponses, mockLLM, "url", "key");
        assert(false, "Should have thrown error");
    } catch (error) {
        assert(error instanceof Error && error.message.includes("No text found"));
    }
});

_test("processOCRWithLLM handles LLM response without content", async () => {
    const ocrResponses = [{ textAnnotations: [{ description: "test text" }] }];
    const mockLLM = async () => ({ }); // Missing content
    
    try {
        await processOCRWithLLM(ocrResponses, mockLLM, "url", "key");
        assert(false, "Should have thrown error");
    } catch (error) {
        assert(error instanceof Error && error.message.includes("Malformed LLM Response"));
    }
});

_test("upsertCompany succeeds with valid data", async () => {
    const mockSupabase = {
        rpc: async () => ({ data: { id: 1 }, error: null })
    };
    const company = { name: "Test Co", email: "test@example.com" };
    
    const result = await upsertCompany(mockSupabase as any, company);
    assertEquals(result.success, true);
    assertEquals((result as any).data.id, 1);
});

_test("upsertCompany fails with missing name", async () => {
    const mockSupabase = {
        rpc: async () => ({ data: null, error: null })
    };
    const company = { name: "", email: "test@example.com" };
    
    const result = await upsertCompany(mockSupabase as any, company);
    assertEquals(result.success, false);
    assert(result.error && typeof result.error === 'object' && 'message' in result.error && 
           typeof result.error.message === 'string' && result.error.message.includes("required"));
});

_test("Full pipeline processes valid company data successfully", async () => {
    const mockDequeue = generateMockDequeue(1);
    const mockUrl = generateMockGenerateSignedUrls(1);
    const mockVision = generateMockVisionAPICall(1);
    const mockLLM = async () => ({
        content: [{
            text: JSON.stringify({
                name: "ACME Corp",
                email: "info@acme.com", 
                phone: "5551234567",
                industry: ["heating"],
                city: "Boston",
                state: "MA"
            }),
            type: "text"
        }]
    });

    const response = await handler(new Request("http://localhost/worker"), {
        dequeueElement: mockDequeue,
        callVisionAPI: mockVision,
        callLLMAPI: mockLLM,
        generateSignedUrls: mockUrl
    });

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.message, "Processed images successfully");
});

_test("Mixed success/failure batch handles errors gracefully", async () => {
    const mockDequeue = generateMockDequeue(2);
    const mockUrl = generateMockGenerateSignedUrls(2);
    const mockVision = async () => [
        { textAnnotations: [{ description: "Good Company Info" }] },
        { textAnnotations: [{ description: "Bad OCR Data" }] }
    ];
    
    let callCount = 0;
    const mockLLM = async (req: any) => {
        callCount++;
        if (callCount === 1) {
            return { content: [{ text: '{"name":"Good Co","email":"good@co.com","industry":[]}', type: "text" }] };
        }
        // Second call fails validation (missing required name field)
        return { content: [{ text: '{"email":"bad@co.com","industry":[]}', type: "text" }] };
    };

    const response = await handler(new Request("http://localhost/worker"), {
        dequeueElement: mockDequeue,
        callVisionAPI: mockVision,
        callLLMAPI: mockLLM,
        generateSignedUrls: mockUrl
    });

    // Should return 500 due to validation failure on second item
    assertEquals(response.status, 500);
    const body = await response.json();
    assert(body.error.includes("LLM output validation failed"));
});
