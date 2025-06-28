import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { TestHttpClient } from "./utils/test-client.ts";
import { DatabaseTestHelpers } from "./utils/database-helpers.ts";
import { fixtures } from "./utils/fixtures.ts";

Deno.test("E2E: Duplicate Detection - Same image uploaded twice results in single company", async (t) => {
  const httpClient = new TestHttpClient();
  const dbHelpers = new DatabaseTestHelpers();

  await t.step("Setup: Clean test environment", async () => {
    await dbHelpers.cleanupTestData();
  });

  await t.step("Step 1: Upload original image", async () => {
    const originalImage = await fixtures.getValidCompanyImage();
    
    const response = await httpClient.uploadSingleImage(originalImage);
    assertEquals(response.status, 200, "First upload should succeed");
  });

  await t.step("Step 2: Wait for first image to process automatically", async () => {
    // Wait for automatic processing
    const processingComplete = await dbHelpers.waitForProcessingComplete(1, 60000);
    assertEquals(processingComplete, true, "First image should process successfully via automatic trigger");
  });

  await t.step("Step 3: Verify first processing results", async () => {
    const companyCount = await dbHelpers.getCompanyCount();
    assertEquals(companyCount, 1, "Should have 1 company after first upload");
    
    const photoCount = await dbHelpers.getVehiclePhotoCount();
    assertEquals(photoCount, 1, "Should have 1 photo record");
  });

  await t.step("Step 4: Upload duplicate image", async () => {
    const duplicateImage = await fixtures.getValidCompanyImage();
    
    const response = await httpClient.uploadSingleImage(duplicateImage);
    assertEquals(response.status, 200, "Duplicate upload should succeed");
  });

  await t.step("Step 5: Wait for duplicate image processing", async () => {
    // Wait for automatic processing of duplicate
    await new Promise(resolve => setTimeout(resolve, 10000));
  });

  await t.step("Step 6: Verify duplicate handling", async () => {
    const companyCount = await dbHelpers.getCompanyCount();
    assertEquals(companyCount, 1, "Should still have only 1 company (duplicate not inserted)");
    
    const photoCount = await dbHelpers.getVehiclePhotoCount();
    assertEquals(photoCount, 2, "Should have 2 photo records (both uploads tracked)");
    
    const processedPhotos = await dbHelpers.getVehiclePhotosWithStatus("processed");
    assertEquals(processedPhotos.length, 2, "Both photos should be marked as processed");
  });

  await t.step("Step 7: Verify company linkage", async () => {
    const processedPhotos = await dbHelpers.getVehiclePhotosWithStatus("processed");
    
    // Both photos should link to the same company
    const companyIds = processedPhotos.map(photo => photo.company_id);
    assertEquals(companyIds[0], companyIds[1], "Both photos should link to the same company ID");
    
    const companies = await dbHelpers.getCompaniesWithName("");
    assertExists(companies[0], "Company should exist");
    
    console.log("Duplicate detection successful:", {
      companyName: companies[0].name,
      totalPhotos: processedPhotos.length,
      uniqueCompanies: companies.length
    });
  });

  await t.step("Step 8: Test rapid duplicate uploads", async () => {
    // Test uploading the same image multiple times in quick succession
    const duplicateImages = await fixtures.getDuplicateImages();
    
    const response = await httpClient.uploadImages(duplicateImages);
    assertEquals(response.status, 200, "Rapid duplicate uploads should succeed");
    
    // Wait for automatic processing of the new uploads
    await new Promise(resolve => setTimeout(resolve, 6000));
    
    // Should still have only 1 company
    const finalCompanyCount = await dbHelpers.getCompanyCount();
    assertEquals(finalCompanyCount, 1, "Rapid duplicates should not create additional companies");
  });

  await t.step("Cleanup: Remove test data", async () => {
    await dbHelpers.cleanupTestData();
  });
});