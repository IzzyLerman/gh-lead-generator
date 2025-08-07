import type { 
  ZoomInfoCompanySearchParams, 
  ZoomInfoCompanySearchResponse,
  ZoomInfoContactSearchParams,
  ZoomInfoContactSearchResponse,
  ZoomInfoEnrichContactParams,
  ZoomInfoEnrichContactResponse
} from './zoominfo-api.ts';
import type { ZoomInfoAuthManager } from './zoominfo-auth.ts';
import type { IZoomInfoService, CompanySearchInput } from './zoominfo-service.ts';

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

// Mock data for contact search
export const mockZoomInfoContactSearchResponse: ZoomInfoContactSearchResponse = {
  maxResults: 10,
  totalResults: 3,
  currentPage: 1,
  data: [
    {
      id: 98765001, 
      zoominfo_id: 98765001,
      firstName: "John",
      lastName: "Smith",
      jobTitle: "CEO",
      jobFunction: "Executive",
      managementLevel: "C-Level",
      email: "john.smith@company.com",
      phone: "+1-555-0101",
      directPhone: "+1-555-0102",
      hasEmail: true,
      hasDirect: true,
      hasPhone: true,
      companyId: 12345001,
      companyName: "ABC Plumbing Services"
    },
    {
      id: 98765002,
      zoominfo_id: 98765001,
      firstName: "Jane",
      lastName: "Johnson",
      jobTitle: "President",
      jobFunction: "Executive",
      managementLevel: "C-Level",
      email: "jane.johnson@company.com",
      phone: "+1-555-0201",
      directPhone: "+1-555-0202",
      hasEmail: true,
      hasDirect: true,
      hasPhone: true,
      companyId: 12345002,
      companyName: "XYZ Landscaping LLC"
    },
    {
      id: 98765003,
      zoominfo_id: 98765001,
      firstName: "Bob",
      lastName: "Williams",
      jobTitle: "Owner",
      jobFunction: "Executive",
      managementLevel: "Owner",
      email: "bob.williams@company.com",
      phone: "+1-555-0301",
      directPhone: "+1-555-0302",
      hasEmail: true,
      hasDirect: true,
      hasPhone: true,
      companyId: 12345003,
      companyName: "Smith Electric Co."
    }
  ]
};

// Mock data for contact enrichment
export const mockZoomInfoEnrichContactResponse: ZoomInfoEnrichContactResponse = {
  maxResults: 10,
  totalResults: 3,
  currentPage: 1,
  data: {
    outputFields: ["firstName", "lastName", "email", "phone", "jobTitle", "jobFunction", "managementLevel", "contactAccuracyScore", "companyRevenueNumeric", "companyIndustries", "lastUpdatedDate", "externalUrls"],
    result: [{
      data: [
    {
      id: 98765001,
      zoominfo_id: 98765001,
      firstName: "John",
      lastName: "Smith",
      email: "john.smith@company.com",
      phone: "+1-555-0101",
      jobTitle: "CEO",
      jobFunction: "Executive",
      managementLevel: "C-Level",
      contactAccuracyScore: 85,
      companyRevenueNumeric: 5000000,
      companyIndustries: ["Construction", "Plumbing"],
      lastUpdatedDate: "2024-01-15T10:30:00Z",
      hasCanadianEmail: false,
      directPhoneDoNotCall: false,
      mobilePhoneDoNotCall: false,
      hashedEmails: ["hash1", "hash2"],
      street: "123 Main St",
      externalUrls: ["https://company.com/john-smith"],
      company: {
        revenueNumeric: 5000000
      }
    },
    {
      id: 98765002,
      zoominfo_id: 98765001,
      firstName: "Jane",
      lastName: "Johnson",
      email: "jane.johnson@company.com",
      phone: "+1-555-0201",
      jobTitle: "President",
      jobFunction: "Executive",
      managementLevel: "C-Level",
      contactAccuracyScore: 90,
      companyRevenueNumeric: 3000000,
      companyIndustries: ["Landscaping", "Outdoor Services"],
      lastUpdatedDate: "2024-01-16T14:20:00Z",
      hasCanadianEmail: false,
      directPhoneDoNotCall: false,
      mobilePhoneDoNotCall: false,
      hashedEmails: ["hash3", "hash4"],
      street: "456 Oak Ave",
      externalUrls: ["https://company.com/jane-johnson"],
      company: {
        revenueNumeric: 3000000
      }
    },
    {
      id: 98765003,
      zoominfo_id: 98765001,
      firstName: "Bob",
      lastName: "Williams",
      email: "bob.williams@company.com",
      phone: "+1-555-0301",
      jobTitle: "Owner",
      jobFunction: "Executive",
      managementLevel: "Owner",
      contactAccuracyScore: 95,
      companyRevenueNumeric: 4500000,
      companyIndustries: ["Electrical", "Construction"],
      lastUpdatedDate: "2024-01-17T09:45:00Z",
      hasCanadianEmail: false,
      directPhoneDoNotCall: false,
      mobilePhoneDoNotCall: false,
      hashedEmails: ["hash5", "hash6"],
      street: "789 Pine St",
      externalUrls: ["https://company.com/bob-williams"],
      company: {
        revenueNumeric: 4500000
      }
    }
      ]
    }]
  }
};

// Complete Mock ZoomInfo Service
export class MockZoomInfoService implements IZoomInfoService {
  async searchCompanies(params: ZoomInfoCompanySearchParams): Promise<ZoomInfoCompanySearchResponse> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (params.companyName === 'No Results Company') {
      return mockEmptyZoomInfoResponse;
    }
    
    if (params.companyName === 'Error Company') {
      throw new Error('ZoomInfo API error');
    }
    
    return mockZoomInfoCompanySearchResponse;
  }

  async searchContacts(params: ZoomInfoContactSearchParams): Promise<ZoomInfoContactSearchResponse> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (params.companyId === '999999') {
      throw new Error('ZoomInfo contact search error');
    }
    
    if (params.companyId === '888888') {
      return {
        maxResults: 0,
        totalResults: 0,
        currentPage: 1,
        data: []
      };
    }
    
    return mockZoomInfoContactSearchResponse;
  }

  async enrichContacts(params: ZoomInfoEnrichContactParams): Promise<ZoomInfoEnrichContactResponse> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 150));
    
    if (params.matchPersonInput.some(p => p.personId === 999999)) {
      throw new Error('ZoomInfo enrichment error');
    }
    
    if (params.matchPersonInput.length === 0) {
      return {
        maxResults: 0,
        totalResults: 0,
        currentPage: 1,
        data: {
          outputFields: [],
          result: []
        }
      };
    }
    
    return mockZoomInfoEnrichContactResponse;
  }

  async progressiveCompanySearch(input: CompanySearchInput): Promise<ZoomInfoCompanySearchResponse | null> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    if (input.name === 'No Results Company') {
      return null;
    }
    
    if (input.name === 'Error Company') {
      throw new Error('ZoomInfo progressive search error');
    }
    
    return mockZoomInfoCompanySearchResponse;
  }

  async extractCompanyZipCode(companyId: string): Promise<{ hasLocation: boolean; companyZip: string | null }> {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Mock different scenarios based on company ID
    if (companyId === 'company-with-zip') {
      return { hasLocation: true, companyZip: '12345' };
    }
    
    if (companyId === 'company-with-extended-zip') {
      return { hasLocation: true, companyZip: '10590-8642' };
    }
    
    if (companyId === 'company-no-photos') {
      return { hasLocation: false, companyZip: null };
    }
    
    if (companyId === 'company-no-location') {
      return { hasLocation: false, companyZip: null };
    }
    
    if (companyId === 'company-invalid-location') {
      return { hasLocation: false, companyZip: null };
    }
    
    // Default mock zip code for any other company
    return { hasLocation: true, companyZip: '90210' };
  }
}
