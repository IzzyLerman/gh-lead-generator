import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { TestHttpClient } from "./utils/test-client.ts";
import { DatabaseTestHelpers } from "./utils/database-helpers.ts";
import { fixtures, TestLLMContext } from "./utils/fixtures.ts";

Deno.test("E2E: Company Duplicate Detection - Different images, same company data", async (t) => {
  const httpClient = new TestHttpClient();
  const dbHelpers = new DatabaseTestHelpers();
  const testContext = TestLLMContext.getInstance();

  await t.step("Setup: Clean test environment and force same company", async () => {
    await dbHelpers.cleanupTestData();
    // Force LLM to return ABC Plumbing Services (index 0) for all images
    await testContext.setFixedCompany(0);
  });

  await t.step("Step 1: Upload first image", async () => {
    const images = await fixtures.getMultipleValidImages();
    const firstImage = images[0]; // company-vehicle-1.jpg
    
    const response = await httpClient.uploadSingleImage(firstImage);
    assertEquals(response.status, 200, "First upload should succeed");
    await response.text(); // Consume response body to prevent leaks
  });

  await t.step("Step 2: Wait for first image processing", async () => {
    const processingComplete = await dbHelpers.waitForProcessingComplete(1, 60000);
    assertEquals(processingComplete, true, "First image should process successfully");
  });

  await t.step("Step 3: Verify first company creation", async () => {
    const companyCount = await dbHelpers.getCompanyCount();
    assertEquals(companyCount, 1, "Should have 1 company after first upload");
    
    const photoCount = await dbHelpers.getVehiclePhotoCount();
    assertEquals(photoCount, 1, "Should have 1 photo record");
    
    const companies = await dbHelpers.getCompaniesWithName("ABC Plumbing Services");
    assertEquals(companies.length, 1, "Should find ABC Plumbing Services");
    assertEquals(companies[0].name, "ABC Plumbing Services", "Company name should match");
  });

  await t.step("Step 4: Upload second image (different file, same company)", async () => {
    const images = await fixtures.getMultipleValidImages();
    const secondImage = images[1]; // company-vehicle-2.jpg
    
    const response = await httpClient.uploadSingleImage(secondImage);
    assertEquals(response.status, 200, "Second upload should succeed");
    await response.text(); // Consume response body to prevent leaks
  });


  await t.step("Step 5: Verify duplicate detection - same company", async () => {
    await new Promise(resolve => setTimeout(resolve, 3000)); //Wait for processing
    const companyCount = await dbHelpers.getCompanyCount();
    assertEquals(companyCount, 1, "Should still have only 1 company (duplicate detected by name)");
    
    const photoCount = await dbHelpers.getVehiclePhotoCount();
    assertEquals(photoCount, 2, "Should have 2 photo records (different images tracked)");
    
  });

  await t.step("Step 6: Upload third image (different file, same company)", async () => {
    const images = await fixtures.getMultipleValidImages();
    const thirdImage = images[2]; // company-vehicle-3.jpg
    
    const response = await httpClient.uploadSingleImage(thirdImage);
    assertEquals(response.status, 200, "Third upload should succeed");
    await response.text(); // Consume response body to prevent leaks
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 8000));
  });

  await t.step("Step 7: Verify triple duplicate detection", async () => {
    const companyCount = await dbHelpers.getCompanyCount();
    assertEquals(companyCount, 1, "Should still have only 1 company after 3 uploads");
    
    const photoCount = await dbHelpers.getVehiclePhotoCount();
    assertEquals(photoCount, 3, "Should have 3 photo records");
    
  });

  await t.step("Step 8: Verify all photos link to same company", async () => {
    const processedPhotos = await dbHelpers.getVehiclePhotosWithStatus('processed');
    
    // All photos should link to the same company ID
    const companyIds = processedPhotos.map((photo: any) => photo.company_id);
    const uniqueCompanyIds = [...new Set(companyIds)];
    assertEquals(uniqueCompanyIds.length, 1, "All photos should link to the same company ID");
    
    const companies = await dbHelpers.getCompaniesWithName("ABC Plumbing Services");
    assertExists(companies[0], "Company should exist");
    assertEquals(companies[0].id, companyIds[0], "Photo company_id should match company table");
    
    console.log("Company duplicate detection successful:", {
      companyName: companies[0].name,
      companyId: companies[0].id,
      totalPhotos: processedPhotos.length,
      allPhotosLinkedToSameCompany: uniqueCompanyIds.length === 1
    });
  });

  await t.step("Step 9: Verify company data integrity", async () => {
    const companies = await dbHelpers.getCompaniesWithName("ABC Plumbing Services");
    const company = companies[0];
    
    // Verify company data matches expected mock data
    assertEquals(company.name, "ABC Plumbing Services", "Company name should be correct");
    assertEquals(company.email?.includes("info@abcplumbing.com"), true, "Email should be present");
    assertEquals(company.phone?.includes("5551234567"), true, "Phone should be present");
    assertEquals(company.industry?.includes("plumbing"), true, "Industry should include plumbing");
    assertEquals(company.city, "Dallas", "City should be Dallas");
    assertEquals(company.state, "TX", "State should be TX");
  });

  await t.step("Step 10: Test rapid batch upload with same company", async () => {
    const images = await fixtures.getMultipleValidImages();
    const batchImages = images.slice(3, 5); // Get 2 more images
    
    const response = await httpClient.uploadImages(batchImages);
    assertEquals(response.status, 200, "Batch upload should succeed");
    await response.text(); // Consume response body to prevent leaks
    
    // Wait for batch processing
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Should still have only 1 company
    const finalCompanyCount = await dbHelpers.getCompanyCount();
    assertEquals(finalCompanyCount, 1, "Rapid batch uploads should not create additional companies");
    
    const finalPhotoCount = await dbHelpers.getVehiclePhotoCount();
    assertEquals(finalPhotoCount, 5, "Should have 5 total photo records");
  });

  await t.step("Cleanup: Clear test context and remove test data", async () => {
    await testContext.clearFixedCompany();
    await dbHelpers.cleanupTestData();
  });
});
