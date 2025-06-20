

import { assertEquals, assert } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { handler } from "../worker/index.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);


// make a mockDequeue function that returns a response containing n messages
function generateMockDequeue(n: number) {
  return async (supabase, _n) => {
    const range = Array.from({ length: n }, (_, i) => i);
    return {
      data: range.map(i => ({
        msg_id: i,
        message: { image_path: "test" }
      })),
      error: null
    }
  };
}

function generateMockVisionAPICall(n: number) {
    return async (req, url, key) =>{
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
  return async (supabase, messages) => {
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

const mockLLMAPICall = async (req, url, key) =>{
    return Promise.resolve({
            "content": [{
                "text": "test LLM response",
                "type" : "text"
                }
            ]
        });
}

function _test(name: string, fn: (ReturnType<void>)) {
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
    const mockDequeue = async() => { throw new Error("Failed to dequeue");}
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
    const mockUrl = async() => { throw new Error('Failed to create signed URL') };
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
    const mockVision = async() => {throw new Error("Vision API is down")};

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
    const mockLLM = async () => { throw new Error("LLM is unavailable")};

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
    const mockLLM = async () => { return Promise.resolve( "lmao" )};

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
    const mockLLM = async (req, url, key) =>{
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
