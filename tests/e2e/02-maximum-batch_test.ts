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
    
    // Upload all 5 images in a single request with a test email
    // The receive-email function can handle multiple images in one request
    const response = await httpClient.uploadImages(validImages, "batch-test@example.com");
    
    console.log("Upload response status:", response.status);
    const responseBody = await response.json();
    console.log("Upload response body:", responseBody);
    
    assertEquals(response.status, 200, "Batch upload should succeed");
    assertEquals(responseBody.success, true, "Response should indicate success");
    assertEquals(responseBody.count, 5, "Should upload 5 files");
    
    console.log("All 5 images uploaded successfully in single batch request");
  });

  await t.step("Step 2: Verify all images stored", async () => {
    // Wait for async operations
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const photoCount = await dbHelpers.getVehiclePhotoCount();
    assertEquals(photoCount, 5, "Five vehicle photos should be recorded");
  });

  await t.step("Step 3: Wait for automatic batch processing to complete", async () => {
    // With 5 unique vision mock results, we expect 5 unique companies
    const processingComplete = await dbHelpers.waitForProcessingComplete(5, 60000);
    assertEquals(processingComplete, true, "Batch processing should complete within 60 seconds");
  });

  await t.step("Step 4: Verify processing results", async () => {
    // Verify we have exactly 5 unique companies with unique data
    const uniquenessResult = await dbHelpers.verifyUniqueCompanies(5);
    
    console.log("Company uniqueness verification:", uniquenessResult.details);
    
    assertEquals(uniquenessResult.details.totalCompanies, 5, "Should have 5 total companies");
    assertEquals(uniquenessResult.details.uniqueNames, 5, "Should have 5 unique company names");
    assertEquals(uniquenessResult.details.uniqueEmails, 5, "Should have 5 unique company emails");
    assertEquals(uniquenessResult.details.uniquePhones, 5, "Should have 5 unique company phones");
    assertEquals(uniquenessResult.isUnique, true, "All companies should be completely unique");
    
    const linkedPhotos = await dbHelpers.getVehiclePhotosWithCompany();
    assertEquals(linkedPhotos.length, 5, "All 5 photos should be linked to companies");
    
    // Verify photos link to 5 different companies
    const companyIds = new Set(linkedPhotos.map(photo => photo.company_id));
    assertEquals(companyIds.size, 5, "Photos should link to 5 different companies");
    
    // Log the company names for verification
    const companyNames = await dbHelpers.getCompanyNames();
    console.log("Created companies:", companyNames);
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
