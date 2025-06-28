import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { TestHttpClient } from "./utils/test-client.ts";
import { DatabaseTestHelpers } from "./utils/database-helpers.ts";
import { fixtures } from "./utils/fixtures.ts";

Deno.test("E2E: Single Success Flow - Valid company image processes through full pipeline", async (t) => {
  const httpClient = new TestHttpClient();
  const dbHelpers = new DatabaseTestHelpers();

  await t.step("Setup: Clean test environment", async () => {
    await dbHelpers.cleanupTestData();
    
    // Verify clean state
    const companyCount = await dbHelpers.getCompanyCount();
    const photoCount = await dbHelpers.getVehiclePhotoCount();
    const queueSize = await dbHelpers.getQueueSize();
    
    assertEquals(companyCount, 0, "Companies table should be empty");
    assertEquals(photoCount, 0, "Vehicle photos table should be empty");
    assertEquals(queueSize, 0, "Queue should be empty");
  });

  await t.step("Step 1: Upload valid company vehicle image", async () => {
    const validImage = await fixtures.getValidCompanyImage();
    
    const response = await httpClient.uploadSingleImage(validImage);
    
    assertEquals(response.status, 200, "Upload should succeed");
    
    const responseBody = await response.json();
    console.log("Upload response:", responseBody);
    
    // The receive-email function returns { success: true, paths: [...], count: N }
    assertEquals(responseBody.success, true, "Upload should be successful");
    assertExists(responseBody.paths, "Response should contain file paths");
    assertEquals(responseBody.count, 1, "Should upload one file");
  });

  await t.step("Step 2: Verify image stored in database", async () => {
    // Wait a moment for async operations
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const photoCount = await dbHelpers.getVehiclePhotoCount();
    assertEquals(photoCount, 1, "One vehicle photo should be recorded");
  });

  await t.step("Step 3: Wait for automatic worker processing", async () => {
    const processingComplete = await dbHelpers.waitForProcessingComplete(1, 10000);
    assertEquals(processingComplete, true, "Processing should complete within 10 seconds via automatic worker trigger");
  });

  await t.step("Step 4: Verify company data extracted and stored", async () => {
    const companyCount = await dbHelpers.getCompanyCount();
    assertEquals(companyCount, 1, "One company should be extracted and stored");
    
    const companies = await dbHelpers.getCompaniesWithName("");
    assertExists(companies[0], "Company record should exist");
    
    const company = companies[0];
    assertExists(company.name, "Company should have a name");
    
    // Log the extracted data for manual verification
    console.log("Extracted company data:", {
      name: company.name,
      email: company.email,
      phone: company.phone,
      industry: company.industry,
      location: company.location
    });
  });

  await t.step("Step 5: Verify vehicle photo linked to company", async () => {
    const allPhotos = await dbHelpers.getVehiclePhotosWithCompany();
    assertEquals(allPhotos.length, 1, "One photo should be linked to a company");
    
    const photo = allPhotos[0];
    assertExists(photo.name, "Photo should have file path");
    assertExists(photo.company_id, "Photo should be linked to company");
  });

  await t.step("Step 6: Verify processing completed successfully", async () => {
    // Final verification that processing is complete
    const linkedPhotos = await dbHelpers.getVehiclePhotosWithCompany();
    const companies = await dbHelpers.getCompaniesWithName("");
    
    assertEquals(linkedPhotos.length, 1, "Should have one photo linked to company");
    assertEquals(companies.length, 1, "Should have one extracted company");
  });

  await t.step("Cleanup: Remove test data", async () => {
    await dbHelpers.cleanupTestData();
  });
});
