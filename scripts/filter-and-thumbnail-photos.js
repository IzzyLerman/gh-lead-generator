#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
} from '@imagemagick/magick-wasm';
import { readFile } from 'fs/promises';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BUCKET_NAME = "gh-vehicle-photos";
const THUMBNAIL_MAX_SIZE = 200;

function getEnvVar(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

async function initImageMagick() {
  try {
    const wasmPath = resolve(__dirname, '../node_modules/@imagemagick/magick-wasm/dist/magick.wasm');
    const wasmBytes = await readFile(wasmPath);
    await initializeImageMagick(wasmBytes);
    console.log('ImageMagick initialized successfully');
  } catch (error) {
    console.error('Failed to initialize ImageMagick:', error.message);
    throw error;
  }
}

async function generateThumbnail(imageBuffer) {
  return new Promise((resolve, reject) => {
    try {
      ImageMagick.read(imageBuffer, (image) => {
        try {
          const width = image.width;
          const height = image.height;
          
          if (width > THUMBNAIL_MAX_SIZE || height > THUMBNAIL_MAX_SIZE) {
            const ratio = Math.min(THUMBNAIL_MAX_SIZE / width, THUMBNAIL_MAX_SIZE / height);
            const newWidth = Math.round(width * ratio);
            const newHeight = Math.round(height * ratio);
            
            console.log(`Resizing thumbnail from ${width}x${height} to ${newWidth}x${newHeight}`);
            image.resize(newWidth, newHeight);
          }
          
          image.write(MagickFormat.Jpeg, (data) => {
            resolve(data);
          });
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

async function uploadThumbnail(supabase, imageBuffer, filename) {
  const file = new File([imageBuffer], filename, { type: 'image/jpeg' });
  
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filename, file, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    
  if (error) {
    throw error;
  }
  
  return data;
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node filter-and-thumbnail-photos.js <supabase_url>');
    console.error('Example: node filter-and-thumbnail-photos.js https://your-project.supabase.co');
    process.exit(1);
  }
  
  const supabaseUrl = args[0];
  
  config({ path: resolve(__dirname, '.env') });
  
  try {
    await initImageMagick();
    
    const serviceRoleKey = getEnvVar('SUPABASE_SERVICE_ROLE_KEY');
    
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    
    console.log('Fetching all files from uploads/ folder...');
    const { data: uploadFiles, error: listError } = await supabase.storage
      .from(BUCKET_NAME)
      .list('uploads', {
        limit: 1000,
        sortBy: { column: 'name', order: 'asc' }
      });
    
    if (listError) {
      throw listError;
    }
    
    console.log(`Found ${uploadFiles.length} files in uploads/`);
    
    let processedCount = 0;
    let validPhotos = 0;
    let invalidPhotos = 0;
    
    for (const file of uploadFiles) {
      if (file.name.startsWith('.')) continue;
      
      const photoPath = `uploads/${file.name}`;
      console.log(`\nProcessing: ${photoPath}`);
      
      const { data: photoRecord, error: photoError } = await supabase
        .from('vehicle-photos')
        .select('id, company_id, companies!inner(id, name)')
        .eq('name', photoPath)
        .single();
      
      if (photoError || !photoRecord) {
        console.log(`❌ No valid company link found for ${photoPath} - will be dropped`);
        invalidPhotos++;
        continue;
      }
      
      if (!photoRecord.company_id) {
        console.log(`❌ Photo ${photoPath} has no company_id - will be dropped`);
        invalidPhotos++;
        continue;
      }
      
      console.log(`✅ Photo ${photoPath} is linked to company: ${photoRecord.companies.name}`);
      validPhotos++;
      
      const thumbnailPath = `thumbnails/${file.name}`;
      
      const { data: existingThumbnail } = await supabase.storage
        .from(BUCKET_NAME)
        .list('thumbnails', {
          search: file.name
        });
      
      if (existingThumbnail && existingThumbnail.length > 0) {
        console.log(`  ℹ️ Thumbnail already exists for ${file.name}`);
        continue;
      }
      
      try {
        console.log(`  📥 Downloading original image...`);
        const { data: originalFile, error: downloadError } = await supabase.storage
          .from(BUCKET_NAME)
          .download(photoPath);
        
        if (downloadError) {
          console.log(`  ❌ Failed to download ${photoPath}: ${downloadError.message}`);
          continue;
        }
        
        console.log(`  🖼️ Generating thumbnail...`);
        const arrayBuffer = await originalFile.arrayBuffer();
        const imageBuffer = new Uint8Array(arrayBuffer);
        
        const thumbnailBuffer = await generateThumbnail(imageBuffer);
        
        console.log(`  📤 Uploading thumbnail to ${thumbnailPath}...`);
        await uploadThumbnail(supabase, thumbnailBuffer, thumbnailPath);
        
        console.log(`  ✅ Thumbnail created successfully`);
        
      } catch (error) {
        console.log(`  ❌ Failed to process ${photoPath}: ${error.message}`);
      }
      
      processedCount++;
    }
    
    console.log('\n📊 Summary:');
    console.log(`Total files processed: ${processedCount}`);
    console.log(`Valid photos (linked to companies): ${validPhotos}`);
    console.log(`Invalid photos (will be dropped): ${invalidPhotos}`);
    console.log('\n✅ Script completed successfully!');
    
  } catch (error) {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  }
}

main();
