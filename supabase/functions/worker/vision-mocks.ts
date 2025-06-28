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
const createSuccessResponse = (text: string): VisionAPIResponse => ({
  textAnnotations: [
    { description: text },
    // Additional annotations would normally be here but we only use the first one
  ]
});

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

// Determine response based on image URL/filename
function getMockResponseForImage(imageUri: string): VisionAPIResponse {
  const url = imageUri.toLowerCase();
  
  // Success cases - company vehicle images
  if (url.includes('company-vehicle') || url.includes('valid-company') || url.includes('sample-exif')) {
    return createSuccessResponse(MOCK_COMPANY_OCR_TEXT);
  }
  
  if (url.includes('company-vehicle-1')) {
    return createSuccessResponse(MOCK_COMPANY_OCR_TEXT);
  }
  
  if (url.includes('company-vehicle-2')) {
    return createSuccessResponse(MOCK_COMPANY_OCR_TEXT_2);
  }
  
  if (url.includes('company-vehicle-3')) {
    return createSuccessResponse(MOCK_COMPANY_OCR_TEXT_3);
  }
  
  if (url.includes('company-vehicle-4')) {
    return createSuccessResponse(MOCK_COMPANY_OCR_TEXT_4);
  }
  
  if (url.includes('company-vehicle-5')) {
    return createSuccessResponse(MOCK_COMPANY_OCR_TEXT_5);
  }
  
  if (url.includes('duplicate-test')) {
    return createSuccessResponse(MOCK_COMPANY_OCR_TEXT); // Same company for duplicate testing
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
  return createSuccessResponse(MOCK_COMPANY_OCR_TEXT);
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
  const responses = requests.map(request => {
    const imageUri = request.image.source.imageUri;
    return getMockResponseForImage(imageUri);
  });
  
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