import type { ZoomInfoCompanySearchParams, ZoomInfoCompanySearchResponse } from './zoominfo-api.ts';
import type { ZoomInfoAuthManager } from './zoominfo-auth.ts';

export const mockZoomInfoCompanySearchResponse: ZoomInfoCompanySearchResponse = {
  maxResults: 5,
  totalResults: 5,
  currentPage: 1,
  data: [
    {
      id: 12345001,
      name: "ABC Plumbing Services"
    },
    {
      id: 12345002,
      name: "XYZ Landscaping LLC"
    },
    {
      id: 12345003,
      name: "Smith Electric Co."
    },
    {
      id: 12345004,
      name: "Johnson Roofing Inc."
    },
    {
      id: 12345005,
      name: "Green Valley HVAC"
    }
  ]
};

export const mockEmptyZoomInfoResponse: ZoomInfoCompanySearchResponse = {
  maxResults: 0,
  totalResults: 0,
  currentPage: 1,
  data: []
};

export async function mockGetCompanyFromZoomInfo(
  searchParams: ZoomInfoCompanySearchParams,
  token: string
): Promise<ZoomInfoCompanySearchResponse> {
  if (token !== 'mock-jwt-token') {
    throw new Error('Invalid token');
  }
  
  if (searchParams.companyName === 'No Results Company') {
    return mockEmptyZoomInfoResponse;
  }
  
  if (searchParams.companyName === 'Error Company') {
    throw new Error('ZoomInfo API error');
  }
  
  return mockZoomInfoCompanySearchResponse;
}

export class MockZoomInfoAuthManager {
  async getValidToken(): Promise<string> {
    return 'mock-jwt-token';
  }
}

export function createMockZoomInfoAuthManager(shouldFail = false): ZoomInfoAuthManager {
  if (shouldFail) {
    return {
      getValidToken: async () => {
        throw new Error('Mock auth failure');
      }
    } as unknown as ZoomInfoAuthManager;
  }
  
  return new MockZoomInfoAuthManager() as ZoomInfoAuthManager;
}