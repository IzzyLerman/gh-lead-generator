import { createTestSupabaseClient } from "./test-client.ts";

export class DatabaseTestHelpers {
  private supabase;

  constructor() {
    this.supabase = createTestSupabaseClient();
  }


  async cleanupTestData(): Promise<void> {
    // Clean up in reverse dependency order - delete ALL records
    await this.supabase.from("debug_logs").delete().gte("created_at", "1900-01-01");
    await this.supabase.from("companies").delete().gte("created_at", "1900-01-01");
    await this.supabase.from("vehicle-photos").delete().gte("created_at", "1900-01-01");
    
    // Clean up test state table (for LLM mock atomicity)
    await this.supabase.from("test_state").delete().gte("created_at", "1900-01-01");
    
    // Clean up message queue
    await this.supabase.rpc("pgmq_purge_queue", { queue_name: "image-processing" });
    
    // Clean up storage bucket
    const { data: files } = await this.supabase.storage
      .from("gh-vehicle-photos")
      .list("", { limit: 1000 });
    
    if (files && files.length > 0) {
      const filePaths = files.map(file => file.name);
      await this.supabase.storage
        .from("gh-vehicle-photos")
        .remove(filePaths);
    }
  }

  async getCompanyCount(): Promise<number> {
    const { count } = await this.supabase
      .from("companies")
      .select("*", { count: "exact", head: true });
    return count || 0;
  }

  async getVehiclePhotoCount(): Promise<number> {
    const { count } = await this.supabase
      .from("vehicle-photos")
      .select("*", { count: "exact", head: true });
    return count || 0;
  }

  async getQueueSize(): Promise<number> {
    const { data } = await this.supabase.rpc("pgmq_queue_length", { 
      queue_name: "image-processing" 
    });
    return data || 0;
  }

  async getCompaniesWithName(name: string) {
    const { data } = await this.supabase
      .from("companies")
      .select("*")
      .ilike("name", `%${name}%`);
    return data || [];
  }

  async getVehiclePhotosWithStatus(status: string) {
    const { data } = await this.supabase
      .from("vehicle-photos")
      .select("*")
      .eq("status", status);
    return data || [];
  }

  async getVehiclePhotosWithCompany() {
    const { data } = await this.supabase
      .from("vehicle-photos")
      .select("*")
      .not("company_id", "is", null);
    return data || [];
  }

  async waitForProcessingComplete(
    expectedCompanyCount: number,
    timeoutMs: number = 60000
  ): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const companyCount = await this.getCompanyCount();
      
      if (companyCount >= expectedCompanyCount) {
        return true;
      }
      
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    return false;
  }

  async getDebugLogs(limit: number = 50) {
    const { data } = await this.supabase
      .from("debug_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    return data || [];
  }

  async insertTestJob(photoId: string): Promise<void> {
    await this.supabase.rpc("pgmq_send", {
      queue_name: "image-processing",
      msg: { photo_id: photoId }
    });
  }

  async verifyCompanyData(companyData: {
    name?: string;
    email?: string;
    phone?: string;
    industry?: string;
  }) {
    const { data } = await this.supabase
      .from("companies")
      .select("*")
      .or(
        Object.entries(companyData)
          .filter(([_, value]) => value)
          .map(([key, value]) => `${key}.ilike.%${value}%`)
          .join(",")
      );
    return data || [];
  }

  async getAllCompanies() {
    const { data } = await this.supabase
      .from("companies")
      .select("*")
      .order("created_at", { ascending: true });
    return data || [];
  }

  async verifyUniqueCompanies(expectedCount: number): Promise<{
    isUnique: boolean;
    details: {
      totalCompanies: number;
      uniqueNames: number;
      uniqueEmails: number;
      uniquePhones: number;
      companies: any[];
    }
  }> {
    const companies = await this.getAllCompanies();
    
    const names = new Set(companies.map(c => c.name).filter(Boolean));
    const emails = new Set(companies.map(c => c.email).filter(Boolean));
    const phones = new Set(companies.map(c => c.phone).filter(Boolean));
    
    const isUnique = companies.length === expectedCount && 
                    names.size === expectedCount && 
                    emails.size === expectedCount && 
                    phones.size === expectedCount;
    
    return {
      isUnique,
      details: {
        totalCompanies: companies.length,
        uniqueNames: names.size,
        uniqueEmails: emails.size,
        uniquePhones: phones.size,
        companies: companies.map(c => ({
          name: c.name,
          email: c.email,
          phone: c.phone,
          industry: c.industry
        }))
      }
    };
  }

  async getCompanyNames(): Promise<string[]> {
    const companies = await this.getAllCompanies();
    return companies.map(c => c.name).filter(Boolean);
  }

  async getCompanyEmails(): Promise<string[]> {
    const companies = await this.getAllCompanies();
    return companies.map(c => c.email).filter(Boolean);
  }
}