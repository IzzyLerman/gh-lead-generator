import { createFileFromPath } from "./test-client.ts";

export class TestLLMContext {
  private static instance: TestLLMContext;
  
  static getInstance(): TestLLMContext {
    if (!TestLLMContext.instance) {
      TestLLMContext.instance = new TestLLMContext();
    }
    return TestLLMContext.instance;
  }
  
  async setFixedCompany(index: number) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      
      if (!supabaseUrl || !supabaseKey) {
        console.log("[TEST-CONTEXT] Missing Supabase credentials");
        return;
      }
      
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.50.1");
      const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
      
      const { error } = await supabase.schema('private').rpc('set_test_force_company', { company_index: index });
      
      if (error) {
        console.log(`[TEST-CONTEXT] Error setting forced company: ${error.message}`);
      } else {
        console.log(`[TEST-CONTEXT] Fixed company index set to: ${index}`);
      }
    } catch (error) {
      console.log(`[TEST-CONTEXT] Error setting fixed company: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  async clearFixedCompany() {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      
      if (!supabaseUrl || !supabaseKey) {
        console.log("[TEST-CONTEXT] Missing Supabase credentials");
        return;
      }
      
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.50.1");
      const supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      });
      
      const { error } = await supabase.schema('private').rpc('clear_test_force_company');
      
      if (error) {
        console.log(`[TEST-CONTEXT] Error clearing forced company: ${error.message}`);
      } else {
        console.log(`[TEST-CONTEXT] Fixed company index cleared`);
      }
    } catch (error) {
      console.log(`[TEST-CONTEXT] Error clearing fixed company: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export class TestFixtures {
  private basePath = "./tests/e2e/fixtures";

  async getValidCompanyImage(): Promise<File> {
    return await createFileFromPath(
      `${this.basePath}/TN_Electric_uploads_vehicle_70d29e2a-ea26-4afb-8572-96d6d8385ce0.jpg`,
      "company-vehicle.jpg",
      "image/jpeg"
    );
  }

  async getValidCompanyImageHEIC(): Promise<File> {
    return await createFileFromPath(
      `${this.basePath}/sampe-exif-heic.heic`,
      "company-vehicle.heic",
      "image/heic"
    );
  }

  async getInvalidImage(): Promise<File> {
    return await createFileFromPath(
      `${this.basePath}/sampe-exif-heic.heic`,
      "invalid-no-extension",
      "application/octet-stream"
    );
  }

  async getInvalidVideoFile(): Promise<File> {
    return await createFileFromPath(
      `${this.basePath}/big_buck_bunny.mp4`,
      "video-file.mp4",
      "video/mp4"
    );
  }

  async getMultipleValidImages(): Promise<File[]> {
    const images = [];
    
    // Use specifically named files that match vision mock patterns
    for (let i = 1; i <= 5; i++) {
      const image = await createFileFromPath(
        `${this.basePath}/company-vehicle-${i}.jpg`,
        `company-vehicle-${i}.jpg`,
        "image/jpeg"
      );
      images.push(image);
    }
    
    return images;
  }

  async getMixedBatch(): Promise<{ valid: File[], invalid: File[] }> {
    const valid = [];
    const invalid = [];
    
    // 3 valid images
    for (let i = 1; i <= 3; i++) {
      const image = await createFileFromPath(
        `${this.basePath}/TN_Electric_uploads_vehicle_70d29e2a-ea26-4afb-8572-96d6d8385ce0.jpg`,
        `valid-company-${i}.jpg`,
        "image/jpeg"
      );
      valid.push(image);
    }
    
    // 2 invalid images
    invalid.push(await this.getInvalidImage());
    invalid.push(await this.getInvalidVideoFile());
    
    return { valid, invalid };
  }

  async getDuplicateImages(): Promise<File[]> {
    // Same image file with same name to test duplicate detection
    const image1 = await createFileFromPath(
      `${this.basePath}/TN_Electric_uploads_vehicle_70d29e2a-ea26-4afb-8572-96d6d8385ce0.jpg`,
      "duplicate-test.jpg",
      "image/jpeg"
    );
    
    const image2 = await createFileFromPath(
      `${this.basePath}/TN_Electric_uploads_vehicle_70d29e2a-ea26-4afb-8572-96d6d8385ce0.jpg`,
      "duplicate-test.jpg",
      "image/jpeg"
    );
    
    return [image1, image2];
  }

  createMalformedData(): string {
    return JSON.stringify({ invalid: "data", missing: "files" });
  }

  createCorruptedFormData(): FormData {
    const formData = new FormData();
    formData.append("not-a-file", "corrupted data");
    return formData;
  }

  async createLargeFile(): Promise<File> {
    // Create a 60MB dummy file to test size limits
    const largeData = new Uint8Array(60 * 1024 * 1024); // 60MB
    largeData.fill(255); // Fill with dummy data
    
    const blob = new Blob([largeData], { type: "image/jpeg" });
    return new File([blob], "large-file.jpg", { type: "image/jpeg" });
  }
}

export const fixtures = new TestFixtures();
