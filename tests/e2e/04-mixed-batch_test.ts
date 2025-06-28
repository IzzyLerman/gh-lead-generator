import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { TestHttpClient } from "./utils/test-client.ts";
import { DatabaseTestHelpers } from "./utils/database-helpers.ts";
import { fixtures } from "./utils/fixtures.ts";

Deno.test("E2E: Mixed Batch Processing - 3 valid + 2 invalid images", async (t) => {
  const httpClient = new TestHttpClient();
  const dbHelpers = new DatabaseTestHelpers();

  await t.step("Setup: Clean test environment", async () => {
    await dbHelpers.cleanupTestData();
  });

  await t.step("Step 1: Upload mixed batch (3 valid + 2 invalid)", async () => {
    const { valid, invalid } = await fixtures.getMixedBatch();
    const allImages = [...valid, ...invalid];
    
    assertEquals(valid.length, 3, "Should have 3 valid images");
    assertEquals(invalid.length, 2, "Should have 2 invalid images");
    assertEquals(allImages.length, 5, "Should have 5 total images");
    
    const response = await httpClient.uploadImages(allImages);
    assertEquals(response.status, 200, "Mixed batch upload should succeed");
  });

  await t.step("Step 2: Verify all files uploaded and recorded", async () => {
    // Wait for upload processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const photoCount = await dbHelpers.getVehiclePhotoCount();
    assertEquals(photoCount, 5, "All 5 files should be recorded in vehicle-photos table");
  });

  await t.step("Step 3: Wait for automatic processing completion", async () => {
    // We expect only valid images to create companies (1 unique company from 3 identical valid images)
    const processingComplete = await dbHelpers.waitForProcessingComplete(1, 120000);
    assertEquals(processingComplete, true, "Mixed batch processing should complete automatically");
  });

  await t.step("Step 4: Verify partial success results", async () => {
    const companyCount = await dbHelpers.getCompanyCount();
    assertEquals(companyCount, 1, "Should have 1 company from valid images");
    
    const processedPhotos = await dbHelpers.getVehiclePhotosWithStatus("processed");
    assertEquals(processedPhotos.length, 3, "Only 3 valid images should be processed successfully");
    
    const failedPhotos = await dbHelpers.getVehiclePhotosWithStatus("failed");
    assertEquals(failedPhotos.length, 2, "2 invalid images should be marked as failed");
  });

  await t.step("Step 5: Verify error handling for invalid files", async () => {
    const debugLogs = await dbHelpers.getDebugLogs(20);
    
    // Should have some error logs for invalid files, but no system crashes
    const errorLogs = debugLogs.filter(log => 
      log.level === 'error' && 
      (log.message.includes('vision') || log.message.includes('parsing') || log.message.includes('invalid'))
    );
    
    // We expect some errors for invalid files
    const hasExpectedErrors = errorLogs.length > 0;
    assertEquals(hasExpectedErrors, true, "Should have logged errors for invalid files");
    
    console.log("Error logs for invalid files:", errorLogs.length);
  });

  await t.step("Step 6: Verify successful data extraction", async () => {
    const companies = await dbHelpers.getCompaniesWithName("");
    assertExists(companies[0], "Valid company should be extracted");
    
    const company = companies[0];
    assertExists(company.name, "Company should have extracted data");
    
    // Verify that valid photos link to the company
    const processedPhotos = await dbHelpers.getVehiclePhotosWithStatus("processed");
    const validCompanyIds = processedPhotos.map(photo => photo.company_id);
    const uniqueCompanyIds = new Set(validCompanyIds);
    
    assertEquals(uniqueCompanyIds.size, 1, "All valid photos should link to same company");
    assertEquals(Array.from(uniqueCompanyIds)[0], company.id, "Photos should link to extracted company");
    
    console.log("Mixed batch results:", {
      totalUploaded: 5,
      successfullyProcessed: 3,
      failed: 2,
      companiesExtracted: 1,
      companyName: company.name
    });
  });

  await t.step("Step 7: Verify system stability", async () => {
    // System should still be responsive after handling invalid files
    const healthResponse = await httpClient.triggerWorker();
    const isHealthy = healthResponse.status >= 200 && healthResponse.status < 500;
    assertEquals(isHealthy, true, "System should remain responsive after mixed batch");
  });

  await t.step("Cleanup: Remove test data", async () => {
    await dbHelpers.cleanupTestData();
  });
});