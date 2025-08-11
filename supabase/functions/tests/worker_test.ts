

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

function generateMockLLMWithUniqueCompanies(n: number) {
    const companies = [
        {
            name: "ABC Plumbing Services",
            email: "info@abcplumbing.com", 
            phone: "555-0101",
            industry: ["plumbing"],
            city: "Dallas",
            state: "TX"
        },
        {
            name: "XYZ Electrical Corp",
            email: "contact@xyzelectric.com",
            phone: "555-0202", 
            industry: ["electrical"],
            city: "Houston",
            state: "TX"
        },
        {
            name: "DEF HVAC Solutions",
            email: "service@defhvac.com",
            phone: "555-0303",
            industry: ["heating"],
            city: "Austin",
            state: "TX"
        },
        {
            name: "GHI Roofing Experts",
            email: "info@ghiroofing.com",
            phone: "555-0404",
            industry: ["roofing"],
            city: "San Antonio",
            state: "TX"
        },
        {
            name: "JKL Landscaping Pro",
            email: "hello@jkllandscape.com",
            phone: "555-0505",
            industry: ["landscaping"],
            city: "Fort Worth",
            state: "TX"
        }
    ];
    
    let callCount = 0;
    return async (req: any, url: string, key: string) => {
        const companyIndex = callCount % companies.length;
        const company = companies[companyIndex];
        callCount++;
        
        return Promise.resolve({
            content: [{
                text: JSON.stringify(company),
                type: "text"
            }]
        });
    };
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


_test("upsertCompany succeeds with valid data", async () => {
    const mockSupabase = {
        schema: () => ({
            rpc: async () => ({ data: { id: 1 }, error: null })
        })
    };
    const company = { name: "Test Co", email: "test@example.com" };
    
    const result = await upsertCompany(mockSupabase as any, company);
    assertEquals(result.success, true);
    assertEquals((result as any).data.id, 1);
});

_test("upsertCompany fails with missing name", async () => {
    const mockSupabase = {
        schema: () => ({
            rpc: async () => ({ data: null, error: null })
        })
    };
    const company = { name: "", email: "test@example.com" };
    
    const result = await upsertCompany(mockSupabase as any, company);
    assertEquals(result.success, false);
    assert(result.error && typeof result.error === 'object' && 'message' in result.error && 
           typeof result.error.message === 'string' && result.error.message.includes("required"));
});


