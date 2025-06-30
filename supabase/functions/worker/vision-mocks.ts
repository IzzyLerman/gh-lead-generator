// Mock Vision API responses for E2E testing
// These mocks replace Google Vision API calls during local testing

export interface VisionAPIRequest {
  image: { source: { imageUri: string } };
  features: { type: string }[];
}

export interface VisionAPIResponse {
  textAnnotations?: { description: string }[];
  error?: any;
}

// Mock company data that Vision API would extract from company vehicle images
const MOCK_COMPANY_OCR_TEXT = `ABC Plumbing Services
Licensed & Insured
(555) 123-4567
info@abcplumbing.com
www.abcplumbing.com
Emergency Service 24/7
Residential & Commercial
License #PL-12345`;

const MOCK_COMPANY_OCR_TEXT_2 = `XYZ Landscaping LLC
Professional Lawn Care
Call: (555) 987-6543
contact@xyzlandscaping.com
Serving Metro Area Since 1995
Free Estimates Available`;

const MOCK_COMPANY_OCR_TEXT_3 = `Smith Electric Co.
Electrical Contractors
Phone: (555) 456-7890
smithelectric@email.com
Licensed Electricians
Residential • Commercial • Industrial`;

const MOCK_COMPANY_OCR_TEXT_4 = `Johnson Roofing Inc.
Quality Roofing Solutions
Tel: (555) 321-9876
info@johnsonroofing.com
25+ Years Experience
Fully Licensed & Bonded`;

const MOCK_COMPANY_OCR_TEXT_5 = `Green Valley HVAC
Heating & Air Conditioning
Phone: (555) 654-3210
service@greenvalleyhvac.com
Emergency Repairs Available
Energy Efficient Solutions`;

// Mock responses for successful OCR
const createSuccessResponse = (companyIndex?: number): VisionAPIResponse => {
  const mockTexts = [
    MOCK_COMPANY_OCR_TEXT,
    MOCK_COMPANY_OCR_TEXT_2,
    MOCK_COMPANY_OCR_TEXT_3,
    MOCK_COMPANY_OCR_TEXT_4,
    MOCK_COMPANY_OCR_TEXT_5
  ];
  
  const text = companyIndex !== undefined && companyIndex >= 1 && companyIndex <= 5 
    ? mockTexts[companyIndex - 1] 
    : MOCK_COMPANY_OCR_TEXT; // default to first company
    
  return {
    textAnnotations: [
      { description: text },
      // Additional annotations would normally be here but we only use the first one
    ]
  };
};

// Mock response for failed OCR (no text detected)
const createFailureResponse = (): VisionAPIResponse => ({
  textAnnotations: []
});

// Mock response for API error
const createErrorResponse = (message: string): VisionAPIResponse => ({
  error: {
    code: 400,
    message: message,
    status: "INVALID_ARGUMENT"
  }
});

// Counter to cycle through different company responses for batch uploads
let batchResponseCounter = 0;

// Helper function to get company index from database or use cycling approach for batches
async function getCompanyIndexFromDatabase(imageUri: string): Promise<number | null> {
  try {
    
    // Extract filename from the URI (remove query parameters and URL parts)
    const filename = imageUri.split('/').pop()?.split('?')[0];
    if (!filename) {
      return null;
    }
    
    
    // Get Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      return null;
    }
    
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.50.1");
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Look up the vehicle photo by filename
    const { data, error } = await supabase
      .from("vehicle-photos")
      .select("submitted_by, created_at")
      .eq("name", filename)
      .single();
    
    if (error || !data) {
      return null;
    }
    
    
    // For batch-test emails, use cycling approach based on creation order
    const email = data.submitted_by;
    if (email === "batch-test@example.com") {
      // Get all photos from this batch to determine processing order
      const { data: allPhotos, error: allError } = await supabase
        .from("vehicle-photos")
        .select("name, created_at")
        .eq("submitted_by", "batch-test@example.com")
        .order("created_at", { ascending: true });
      
      if (allError || !allPhotos) {
        return null;
      }
      
      // Find the index of current photo in the batch
      const photoIndex = allPhotos.findIndex(photo => photo.name === filename);
      if (photoIndex !== -1) {
        const companyIndex = (photoIndex % 5) + 1; // Cycle through 1-5
        return companyIndex;
      }
    }
    
    // Extract company index from individual test emails (1@example.com -> 1, etc.)
    if (email && email.includes("@example.com")) {
      const match = email.match(/^(\d+)@example\.com$/);
      if (match) {
        const index = parseInt(match[1]);
        if (index >= 1 && index <= 5) {
          return index;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error(`[VISION-MOCK] Error looking up company index from database:`, error);
    return null;
  }
}

// Determine response based on image URL/filename and database lookup
async function getMockResponseForImage(imageUri: string): Promise<VisionAPIResponse> {
  const url = imageUri.toLowerCase();
  
  // Try to determine company index from database lookup (for E2E tests)
  const companyIndex = await getCompanyIndexFromDatabase(imageUri);
  if (companyIndex !== null) {
    return createSuccessResponse(companyIndex);
  }
  
  // Specific company vehicle images (check these first before generic patterns)
  if (url.includes('company-vehicle-1')) {
    return createSuccessResponse(1);
  }
  
  if (url.includes('company-vehicle-2')) {
    return createSuccessResponse(2);
  }
  
  if (url.includes('company-vehicle-3')) {
    return createSuccessResponse(3);
  }
  
  if (url.includes('company-vehicle-4')) {
    return createSuccessResponse(4);
  }
  
  if (url.includes('company-vehicle-5')) {
    return createSuccessResponse(5);
  }
  
  // Generic patterns (fallback for other company vehicle images)
  if (url.includes('company-vehicle') || url.includes('valid-company') || url.includes('sample-exif')) {
    return createSuccessResponse(); // uses default (first company)
  }
  
  if (url.includes('duplicate-test')) {
    return createSuccessResponse(1); // Same company for duplicate testing
  }
  
  // Failure cases - invalid images
  if (url.includes('personal-photo') || url.includes('ex.heic')) {
    return createFailureResponse(); // No text detected
  }
  
  if (url.includes('video-file') || url.includes('big_buck_bunny')) {
    return createErrorResponse("Video files are not supported for text detection");
  }
  
  if (url.includes('large-file')) {
    return createErrorResponse("File size exceeds maximum allowed limit");
  }
  
  // Default to success for unknown files (to avoid breaking tests)
  return createSuccessResponse();
}

// Main mock function that replaces callVisionAPI
export async function mockVisionAPI(
  requests: VisionAPIRequest[],
  _url?: string,
  _key?: string
): Promise<VisionAPIResponse[]> {
  
  // Simulate API latency
  await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
  
  // Process each request and return appropriate mock response
  const responses = await Promise.all(
    requests.map(async request => {
      const imageUri = request.image.source.imageUri;
      return await getMockResponseForImage(imageUri);
    })
  );
  
  return responses;
}

// Mock function that always fails (for testing error handling)
export async function mockVisionAPIWithFailure(
  _requests: VisionAPIRequest[],
  _url?: string,
  _key?: string
): Promise<VisionAPIResponse[]> {
  await new Promise(resolve => setTimeout(resolve, 100));
  throw new Error("Mock Vision API failure for testing");
}

// Mock function that returns network errors
export async function mockVisionAPIWithNetworkError(
  _requests: VisionAPIRequest[],
  _url?: string,
  _key?: string
): Promise<VisionAPIResponse[]> {
  await new Promise(resolve => setTimeout(resolve, 100));
  throw new Error("Network error: Connection timeout");
}

// Helper to log mock responses (for debugging)
export function logMockResponse(imageUri: string, response: VisionAPIResponse) {
  console.log(`Mock Vision API response for ${imageUri}:`, {
    hasText: !!response.textAnnotations?.length,
    hasError: !!response.error,
    textPreview: response.textAnnotations?.[0]?.description?.substring(0, 50) + "..."
  });
}
