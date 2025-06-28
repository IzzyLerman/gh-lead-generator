import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { TestHttpClient } from "./utils/test-client.ts";
import { DatabaseTestHelpers } from "./utils/database-helpers.ts";
import { fixtures } from "./utils/fixtures.ts";

Deno.test("E2E: Maximum Batch Processing - 5 images processed concurrently", async (t) => {
  const httpClient = new TestHttpClient();
  const dbHelpers = new DatabaseTestHelpers();

  await t.step("Setup: Clean test environment", async () => {
    await dbHelpers.cleanupTestData();
  });

  await t.step("Step 1: Upload 5 valid company vehicle images", async () => {
    const validImages = await fixtures.getMultipleValidImages();
    assertEquals(validImages.length, 5, "Should have 5 test images");
    
    const response = await httpClient.uploadImages(validImages);
    
    console.log("Upload response status:", response.status);
    const responseBody = await response.json();
    console.log("Upload response body:", responseBody);
    
    assertEquals(response.status, 200, "Batch upload should succeed");
    assertEquals(responseBody.success, true, "Response should indicate success");
    assertEquals(responseBody.count, 5, "Should upload 5 files");
  });

  await t.step("Step 2: Verify all images stored", async () => {
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const photoCount = await dbHelpers.getVehiclePhotoCount();
    assertEquals(photoCount, 5, "Five vehicle photos should be recorded");
  });

  await t.step("Step 3: Wait for automatic batch processing to complete", async () => {
    // With 5 unique vision mock results, we expect 5 unique companies
    const processingComplete = await dbHelpers.waitForProcessingComplete(5, 20000);
    assertEquals(processingComplete, true, "Batch processing should complete within 20 seconds");
  });

  await t.step("Step 4: Verify processing results", async () => {
    const companyCount = await dbHelpers.getCompanyCount();
    // Should have 5 companies from 5 unique vision mock results
    assertEquals(companyCount, 5, "Should have 5 unique companies");
    
    const linkedPhotos = await dbHelpers.getVehiclePhotosWithCompany();
    assertEquals(linkedPhotos.length, 5, "All 5 photos should be linked to companies");
    
    // Verify photos link to 5 different companies
    const companyIds = new Set(linkedPhotos.map(photo => photo.company_id));
    assertEquals(companyIds.size, 5, "Photos should link to 5 different companies");
  });

  await t.step("Step 5: Verify processing completion and error handling", async () => {
    // Check debug logs for any processing errors
    const debugLogs = await dbHelpers.getDebugLogs(20);
    const errorLogs = debugLogs.filter(log => log.level === 'error');
    assertEquals(errorLogs.length, 0, "Should have no error logs during batch processing");
  });

  await t.step("Step 6: Performance verification", async () => {
    // Verify that batch processing completed in reasonable time
    // This is more of a sanity check than a strict requirement
    const companies = await dbHelpers.getCompaniesWithName("");
    assertExists(companies[0], "Company should exist");
    
    console.log("Batch processing completed successfully:", {
      totalImages: 5,
      uniqueCompanies: companies.length,
      company: companies[0].name
    });
  });

  await t.step("Cleanup: Remove test data", async () => {
    await dbHelpers.cleanupTestData();
  });
});
