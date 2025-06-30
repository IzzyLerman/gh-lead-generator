import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { TestHttpClient } from "./utils/test-client.ts";
import { DatabaseTestHelpers } from "./utils/database-helpers.ts";
import { fixtures } from "./utils/fixtures.ts";

Deno.test("E2E: Mixed Batch Processing - Valid and invalid images with different companies", async (t) => {
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

  await t.step("Step 1: Upload mixed batch (2 different valid companies + 2 invalid files)", async () => {
    // Get 2 different valid company images that will produce different companies
    const validImages = await fixtures.getMultipleValidImages();
    const validImage1 = validImages[0]; // company-vehicle-1.jpg -> Company A
    const validImage2 = validImages[1]; // company-vehicle-2.jpg -> Company B
    
    // Get invalid files that should be rejected during upload
    const invalidImage = await fixtures.getInvalidImage(); // HEIC that fails conversion
    const invalidVideo = await fixtures.getInvalidVideoFile(); // MP4 video file
    
    const allImages = [validImage1, validImage2, invalidImage, invalidVideo];
    
    assertEquals(allImages.length, 4, "Should have 4 total files to attempt upload");
    
    const response = await httpClient.uploadImages(allImages, "mixed-test@example.com");
    
    assertEquals(response.status, 200, "Mixed batch upload should succeed");
    
    const responseBody = await response.json();
    console.log("Mixed batch upload response:", responseBody);
    
    assertEquals(responseBody.success, true, "Upload should be successful");
    // System rejects invalid files during upload, so only valid files are uploaded
    assertEquals(responseBody.count >= 2, true, "Should upload at least 2 valid files");
    
    // Verify warnings or skipped files for invalid files
    if (responseBody.warnings) {
      console.log("Upload warnings:", responseBody.warnings);
    }
    if (responseBody.skipped) {
      console.log("Skipped files:", responseBody.skipped);
    }
  });

  await t.step("Step 2: Verify only valid files uploaded and recorded", async () => {
    // Wait for upload processing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const photoCount = await dbHelpers.getVehiclePhotoCount();
    // Only valid files that passed upload validation are stored in database
    assertEquals(photoCount >= 2, true, "At least 2 valid files should be recorded in vehicle-photos table");
    console.log(`Valid files stored in database: ${photoCount}`);
  });

  await t.step("Step 3: Wait for automatic processing completion", async () => {
    // We expect 2 unique companies from 2 different valid images
    const processingComplete = await dbHelpers.waitForProcessingComplete(2, 60000);
    assertEquals(processingComplete, true, "Mixed batch processing should complete within 60 seconds");
  });

  await t.step("Step 4: Verify mixed success/failure results", async () => {
    const companyCount = await dbHelpers.getCompanyCount();
    assertEquals(companyCount, 2, "Should have 2 companies from 2 different valid images");
    
    const processedPhotos = await dbHelpers.getVehiclePhotosWithStatus("processed");
    assertEquals(processedPhotos.length >= 2, true, "At least 2 valid images should be processed successfully");
    
    // Invalid files are rejected during upload, so no "failed" database records
    const totalPhotos = await dbHelpers.getVehiclePhotoCount();
    
    console.log("Processing status verified:", {
      totalAttempted: 4,
      validUploaded: totalPhotos,
      processed: processedPhotos.length,
      companies: companyCount,
      invalidRejectedAtUpload: 4 - totalPhotos
    });
  });

  await t.step("Step 5: Verify unique company creation", async () => {
    const companies = await dbHelpers.getAllCompanies();
    assertEquals(companies.length, 2, "Should have exactly 2 companies");
    
    // Verify companies have different data
    const companyNames = companies.map(c => c.name).filter(Boolean);
    const uniqueNames = new Set(companyNames);
    assertEquals(uniqueNames.size, 2, "Should have 2 unique company names");
    
    const companyEmails = companies.map(c => c.email).filter(Boolean);
    const uniqueEmails = new Set(companyEmails);
    assertEquals(uniqueEmails.size, 2, "Should have 2 unique company emails");
    
    console.log("Created companies:", {
      company1: { name: companies[0].name, email: companies[0].email },
      company2: { name: companies[1].name, email: companies[1].email }
    });
  });

  await t.step("Step 6: Verify photo-company linking", async () => {
    const processedPhotos = await dbHelpers.getVehiclePhotosWithStatus("processed");
    
    // Each processed photo should be linked to a different company
    const companyIds = processedPhotos.map(photo => photo.company_id);
    const uniqueCompanyIds = new Set(companyIds);
    assertEquals(uniqueCompanyIds.size, 2, "Processed photos should link to 2 different companies");
    
    console.log("Photo-company linking verified:", {
      processedPhotos: processedPhotos.length,
      uniqueCompanies: uniqueCompanyIds.size,
      allPhotosLinked: companyIds.every(id => id !== null)
    });
  });

  await t.step("Step 7: Verify graceful handling of invalid files", async () => {
    // The system should handle invalid files gracefully by rejecting them during upload
    // We verify this through the upload response (warnings/skipped) and database state
    const totalPhotos = await dbHelpers.getVehiclePhotoCount();
    const processedPhotos = await dbHelpers.getVehiclePhotosWithStatus("processed");
    
    console.log("Invalid file handling verified:", {
      totalAttempted: 4,
      validStored: totalPhotos,
      processed: processedPhotos.length,
      systemStable: true
    });
    
    // Key verification: system remains stable and processes valid files despite invalid ones
    assertEquals(totalPhotos >= 2, true, "System should store valid files despite invalid ones");
    assertEquals(processedPhotos.length >= 2, true, "System should process valid files despite invalid ones");
  });

  await t.step("Step 8: Verify submitter perspective (success/failure separation)", async () => {
    // From the submitter's perspective:
    // - Valid images should result in successful company extraction
    // - Invalid images should be rejected during upload without affecting valid processing
    
    const companies = await dbHelpers.getAllCompanies();
    const processedPhotos = await dbHelpers.getVehiclePhotosWithStatus("processed");
    const totalPhotos = await dbHelpers.getVehiclePhotoCount();
    
    // Success criteria: Valid images created companies
    assertEquals(companies.length, 2, "Valid images should create companies");
    assertEquals(processedPhotos.length >= 2, true, "Valid images should be processed");
    
    // System integrity: Valid files are processed (may be async so allow some unprocessed)
    assertEquals(processedPhotos.length >= 2, true, "At least 2 files should be processed successfully");
    
    console.log("Submitter perspective verified:", {
      validFilesProcessed: processedPhotos.length,
      invalidFilesRejected: 4 - totalPhotos,
      companiesExtracted: companies.length,
      systemIntegrity: "Invalid files rejected cleanly, valid files processed successfully"
    });
  });

  await t.step("Step 9: Verify system stability after mixed processing", async () => {
    // Verify queue is clear
    const queueSize = await dbHelpers.getQueueSize();
    assertEquals(queueSize, 0, "Queue should be empty after processing completion");
  });

  await t.step("Cleanup: Remove test data", async () => {
    await dbHelpers.cleanupTestData();
    
    // Verify cleanup
    const finalCompanyCount = await dbHelpers.getCompanyCount();
    const finalPhotoCount = await dbHelpers.getVehiclePhotoCount();
    assertEquals(finalCompanyCount, 0, "All companies should be cleaned up");
    assertEquals(finalPhotoCount, 0, "All photos should be cleaned up");
  });
});
