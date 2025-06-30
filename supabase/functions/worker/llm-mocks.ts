// Mock LLM API responses for E2E testing
// These mocks replace Anthropic Claude API calls during local testing

export interface LLMAPIRequest {
  model: string;
  max_tokens: number;
  messages: { role: string; content: string }[];
}

export interface LLMAPIResponse {
  content?: { text: string; type: string }[];
}

// Mock company data that LLM would extract from OCR results
const MOCK_COMPANIES = [
  {
    name: "ABC Plumbing Services",
    email: "info@abcplumbing.com", 
    phone: "5551234567",
    industry: ["plumbing"],
    city: "Dallas",
    state: "TX",
    website: "www.abcplumbing.com"
  },
  {
    name: "XYZ Landscaping LLC",
    email: "contact@xyzlandscaping.com",
    phone: "5559876543", 
    industry: ["landscaping", "lawn care"],
    city: "Austin",
    state: "TX",
    website: "www.xyzlandscaping.com"
  },
  {
    name: "Smith Electric Co.",
    email: "smithelectric@email.com",
    phone: "5554567890",
    industry: ["electrical"],
    city: "Houston", 
    state: "TX",
    website: "www.smithelectric.com"
  },
  {
    name: "Johnson Roofing Inc.",
    email: "info@johnsonroofing.com",
    phone: "5553219876",
    industry: ["roofing"],
    city: "San Antonio",
    state: "TX",
    website: "www.johnsonroofing.com"
  },
  {
    name: "Green Valley HVAC",
    email: "service@greenvalleyhvac.com", 
    phone: "5556543210",
    industry: ["heating", "cooling", "ventilation"],
    city: "Fort Worth",
    state: "TX",
    website: "www.greenvalleyhvac.com"
  }
];

// Helper function to get fixed company index from database
async function getFixedCompanyIndex(): Promise<number | null> {
  try {
    // Get Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      console.log("[LLM-MOCK] Missing Supabase credentials, cannot check for forced company");
      return null;
    }
    
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.50.1");
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    // Call the database function to get forced company index
    const { data, error } = await supabase.schema('private').rpc('get_test_force_company');
    
    if (error) {
      console.log(`[LLM-MOCK] Error getting forced company index: ${error.message}`);
      return null;
    }
    
    console.log(`[LLM-MOCK] Database forced company index: ${data}`);
    return data;
    
  } catch (error) {
    console.log(`[LLM-MOCK] Error checking forced company index: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

// Helper function to get atomic company index using test_state table
async function getAtomicCompanyIndex(): Promise<number> {
  try {
    // Get Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      console.log("[LLM-MOCK] Missing Supabase credentials, using default company 0");
      return 0;
    }
    
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.50.1");
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    // Atomically insert into test_state to get unique sequential ID
    const { data, error } = await supabase
      .from("test_state")
      .insert({})
      .select("id")
      .single();
    
    if (error) {
      console.error("[LLM-MOCK] Error inserting into test_state:", error.message);
      return 0;
    }
    
    const uniqueId = data.id;
    const companyIndex = (uniqueId - 1) % MOCK_COMPANIES.length; // -1 because SERIAL starts at 1
    
    console.log(`[LLM-MOCK] Atomic ID: ${uniqueId}, using company index: ${companyIndex}`);
    return companyIndex;
    
  } catch (error) {
    console.error("[LLM-MOCK] Error getting atomic company index:", error);
    return 0;
  }
}

// Main mock function that replaces callLLMAPI
export async function mockLLMAPI(
  request: LLMAPIRequest,
  _url?: string,
  _key?: string
): Promise<LLMAPIResponse> {
  
  // Check for fixed company index first (for e2e duplicate tests)
  let companyIndex: number;
  const fixedIndex = await getFixedCompanyIndex();
  
  if (fixedIndex !== null) {
    companyIndex = fixedIndex % MOCK_COMPANIES.length;
    console.log(`[LLM-MOCK] Using fixed company index: ${companyIndex}`);
  } else {
    // Get atomic company index using test_state table
    companyIndex = await getAtomicCompanyIndex();
  }
  
  const company = MOCK_COMPANIES[companyIndex];
  
  console.log(`[LLM-MOCK] Processing LLM request, using company ${companyIndex + 1}: ${company.name}`);
  
  // Simulate API latency
  await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 200));
  
  console.log(`[LLM-MOCK] Returning response: ${company.name}`);
  
  // Return the company data as JSON text response
  return {
    content: [{
      text: JSON.stringify(company),
      type: "text"
    }]
  };
}

// Function to get next atomic company index (useful for debugging)
export async function getNextAtomicIndex(): Promise<number> {
  return await getAtomicCompanyIndex();
}

// Mock function that always fails (for testing error handling)
export async function mockLLMAPIWithFailure(
  _request: LLMAPIRequest,
  _url?: string,
  _key?: string
): Promise<LLMAPIResponse> {
  await new Promise(resolve => setTimeout(resolve, 100));
  throw new Error("Mock LLM API failure for testing");
}

// Mock function that returns invalid JSON (for testing validation)
export async function mockLLMAPIWithInvalidJSON(
  _request: LLMAPIRequest,
  _url?: string,
  _key?: string
): Promise<LLMAPIResponse> {
  await new Promise(resolve => setTimeout(resolve, 100));
  return {
    content: [{
      text: "{ invalid json response",
      type: "text"
    }]
  };
}

// Helper to log mock response details (for debugging)
export function logMockLLMResponse(companyIndex: number, company: any) {
  console.log(`[LLM-MOCK] Company ${companyIndex + 1} details:`, {
    name: company.name,
    email: company.email,
    phone: company.phone,
    industries: company.industry?.length || 0
  });
}
