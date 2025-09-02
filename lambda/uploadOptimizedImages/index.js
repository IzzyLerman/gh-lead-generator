const { createClient } = require('@supabase/supabase-js');
const { createLogger } = require('./utils/logger');
const { spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');

const BUCKET_NAME = "gh-vehicle-photos";
const THUMBNAIL_MAX_SIZE = 200;
const FULL_SIZE_QUALITY = 80;
const THUMBNAIL_QUALITY = 50;

const logger = createLogger('upload-optimized-images');

function getEnvVar(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

async function generateSignature(params, apiSecret) {
  const crypto = require('crypto');
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  
  return crypto.createHash('sha1').update(sortedParams + apiSecret).digest('hex');
}

async function uploadToCloudinary(videoFile) {
  logger.debug('Starting Cloudinary upload', {
    filename: videoFile.name,
    type: videoFile.type,
    size: videoFile.size
  });
  
  const CLOUDINARY_CLOUD_NAME = getEnvVar("CLOUDINARY_CLOUD_NAME");
  const CLOUDINARY_API_KEY = getEnvVar("CLOUDINARY_API_KEY");
  const CLOUDINARY_API_SECRET = getEnvVar("CLOUDINARY_API_SECRET");
  
  const timestamp = Math.round(Date.now() / 1000);
  const params = {
    timestamp: timestamp,
  };

  const signature = await generateSignature(params, CLOUDINARY_API_SECRET);
  logger.debug('Generated Cloudinary signature', { timestamp });

  const formData = new FormData();
  formData.append('file', videoFile.buffer, videoFile.name);
  formData.append('api_key', CLOUDINARY_API_KEY);
  formData.append('timestamp', timestamp.toString());
  formData.append('signature', signature);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`,
    {
      method: 'POST',
      body: formData
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Cloudinary upload failed', {
      status: response.status,
      filename: videoFile.name,
      responseLength: errorText.length
    });
    throw new Error(`Cloudinary upload failed: ${response.status}`);
  }

  const result = await response.json();
  logger.debug('Cloudinary upload successful', {
    publicId: result.public_id,
    format: result.format,
    bytes: result.bytes
  });
  
  return result;
}

async function destroyCloudinaryResource(publicId, resourceType = 'video') {
  try {
    const CLOUDINARY_CLOUD_NAME = getEnvVar("CLOUDINARY_CLOUD_NAME");
    const CLOUDINARY_API_KEY = getEnvVar("CLOUDINARY_API_KEY");
    const CLOUDINARY_API_SECRET = getEnvVar("CLOUDINARY_API_SECRET");
    
    const timestamp = Math.round(Date.now() / 1000);
    const params = {
      public_id: publicId,
      timestamp: timestamp,
    };

    const signature = await generateSignature(params, CLOUDINARY_API_SECRET);

    const formData = new FormData();
    formData.append('public_id', publicId);
    formData.append('timestamp', timestamp.toString());
    formData.append('api_key', CLOUDINARY_API_KEY);
    formData.append('signature', signature);

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/destroy`,
      {
        method: 'POST',
        body: formData
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cloudinary destroy failed: ${response.status} ${errorText}`);
    }

    await response.json();
    
  } catch (error) {
    // Silently ignore cleanup failures
  }
}

async function convertHeicToJpg(heicFile, inputBuffer) {
  try {
    logger.debug('Starting HEIC to JPG conversion', {
      filename: heicFile.name,
      originalSize: heicFile.size,
      fileType: heicFile.type
    });
    
    let bufferToUse;
    if (inputBuffer) {
      bufferToUse = inputBuffer;
    } else {
      bufferToUse = heicFile.buffer;
    }
    
    const convert = require('heic-convert');
    
    const jpegBuffer = await convert({
      buffer: bufferToUse,
      format: 'JPEG',
      quality: 0.9
    });
    
    const filename = heicFile.name.replace(/\.heic$/i, '.jpg');
    const convertedFile = {
      name: filename,
      type: 'image/jpeg',
      size: jpegBuffer.length,
      buffer: jpegBuffer
    };
    
    logger.debug('HEIC conversion successful', {
      originalFilename: heicFile.name,
      convertedFilename: filename,
      originalSize: heicFile.size,
      convertedSize: convertedFile.size
    });
    
    return convertedFile;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.logError(error instanceof Error ? error : new Error(String(error)), 'HEIC conversion failed', {
      filename: heicFile.name,
      originalSize: heicFile.size
    });
    throw new Error(`Failed to convert HEIC file ${heicFile.name}: ${errorMessage}`);
  }
}

async function extractVideoFrameFromCloudinary(videoFile) {
  try {
    logger.debug('Starting video frame extraction', {
      filename: videoFile.name,
      type: videoFile.type,
      size: videoFile.size
    });
    
    const CLOUDINARY_CLOUD_NAME = getEnvVar("CLOUDINARY_CLOUD_NAME");
    
    const uploadResponse = await uploadToCloudinary(videoFile);
    
    const publicId = uploadResponse["public_id"];
    logger.debug('Video uploaded, extracting frame', { publicId });
    
    const response = await fetch(`https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/video/upload/so_1,f_jpg/${publicId}.jpg`);
    
    if (!response.ok) {
      logger.error('Failed to download video thumbnail', {
        status: response.status,
        statusText: response.statusText,
        publicId
      });
      throw new Error(`Failed to download thumbnail: ${response.status} ${response.statusText}`);
    }
    
    const frameBuffer = await response.buffer();
    
    const filename = videoFile.name.replace(/\.(mp4|mov)$/i, '.jpg');
    const resultFile = {
      name: filename,
      type: 'image/jpeg',
      size: frameBuffer.length,
      buffer: frameBuffer
    };
    
    logger.debug('Video frame extracted successfully', {
      originalFilename: videoFile.name,
      frameFilename: filename,
      originalSize: videoFile.size,
      frameSize: resultFile.size
    });
    
    // Clean up video from Cloudinary to save storage
    await destroyCloudinaryResource(uploadResponse.public_id, 'video');
    logger.debug('Cloudinary video cleanup completed', { publicId });
    
    return resultFile;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.logError(error instanceof Error ? error : new Error(String(error)), 'Video frame extraction failed', {
      filename: videoFile.name,
      type: videoFile.type
    });
    throw new Error(`Failed to extract frame from video ${videoFile.name}: ${errorMessage}`);
  }
}

async function processFileForVision(file, fileBuffer) {
  logger.debug('Processing file for vision', {
    filename: file.name,
    type: file.type,
    needsProcessing: file.type === 'image/heic' || file.type === 'video/mp4' || file.type === 'video/mov'
  });
  
  if (file.type === 'image/heic') {
    return await convertHeicToJpg(file, fileBuffer);
  } else if (file.type.includes('video')) {
    return await extractVideoFrameFromCloudinary(file);
  } else {
    logger.debug('File requires no processing', { filename: file.name, type: file.type });
    return file;
  }
}

function generateOptimizedFilename(uuid, isFullSize = true) {
  const folder = isFullSize ? "uploads" : "thumbnails";
  return `${folder}/${uuid}.jpg`;
}

async function optimizeImage(imageBuffer, isFullSize) {
  return new Promise((resolve, reject) => {
    try {
      logger.debug('Starting ImageMagick optimization', {
        bufferLength: imageBuffer.length,
        isFullSize
      });
      
      const tempInputFile = path.join('/tmp', `input_${Date.now()}.jpg`);
      const tempOutputFile = path.join('/tmp', `output_${Date.now()}.jpg`);
      
      // Write input file
      fs.writeFileSync(tempInputFile, imageBuffer);
      
      const args = [tempInputFile];
      
      if (!isFullSize) {
        // For thumbnails, resize to fit within max dimensions
        args.push('-resize', `${THUMBNAIL_MAX_SIZE}x${THUMBNAIL_MAX_SIZE}`);
        args.push('-quality', THUMBNAIL_QUALITY.toString());
      } else {
        args.push('-quality', FULL_SIZE_QUALITY.toString());
      }
      
      args.push(tempOutputFile);
      
      logger.debug('Executing ImageMagick convert', {
        command: '/opt/bin/convert',
        args: args
      });
      
      const process = spawn('/opt/bin/convert', args);
      
      let stderr = '';
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('close', (code) => {
        try {
          if (code !== 0) {
            logger.error('ImageMagick process failed', { 
              code,
              stderr,
              args 
            });
            reject(new Error(`ImageMagick failed with code ${code}: ${stderr}`));
            return;
          }
          
          // Read output file
          const outputBuffer = fs.readFileSync(tempOutputFile);
          
          logger.debug('ImageMagick optimization completed', { 
            outputLength: outputBuffer.length,
            isFullSize
          });
          
          // Cleanup temp files
          try {
            fs.unlinkSync(tempInputFile);
            fs.unlinkSync(tempOutputFile);
          } catch (cleanupError) {
            logger.warn('Failed to cleanup temp files', { cleanupError: cleanupError.message });
          }
          
          resolve(outputBuffer);
        } catch (error) {
          logger.error('Error processing ImageMagick output', { 
            error: error instanceof Error ? error.message : String(error) 
          });
          reject(error);
        }
      });
      
      process.on('error', (error) => {
        logger.error('Error spawning ImageMagick process', { 
          error: error.message 
        });
        reject(error);
      });
      
    } catch (error) {
      logger.error('Error in optimizeImage', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      reject(error);
    }
  });
}

async function uploadOptimizedFile(supabase, imageBuffer, filename) {
  logger.debug('Uploading optimized file', {
    filename,
    size: imageBuffer.length
  });
  
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filename, imageBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    
  if (error) {
    logger.error('Storage upload failed', {
      filename,
      error: error.message
    });
    throw error;
  }
  
  logger.debug('Optimized file uploaded successfully', {
    filename,
    path: data.path
  });
  
  return data;
}

exports.handler = async (event) => {
  logger.info('Upload optimized images function started', {
    httpMethod: event.httpMethod
  });


  try {
    const { original_path } = event.body;
    
    if (!original_path) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "original_path is required" })
      };
    }

    const SUPABASE_SERVICE_ROLE_KEY = getEnvVar("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_URL = getEnvVar("SUPABASE_URL");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    logger.debug('Downloading original file', { originalPath: original_path });

    // Download original file
    const { data: originalFile, error: downloadError } = await supabase.storage
      .from(BUCKET_NAME)
      .download(original_path);

    if (downloadError) {
      logger.error('Failed to download original file', {
        originalPath: original_path,
        error: downloadError.message
      });
      throw downloadError;
    }

    // Convert to file object for processing
    const arrayBuffer = await originalFile.arrayBuffer();
    const fileName = original_path.split('/').pop() || 'unknown';
    const file = {
      name: fileName,
      type: originalFile.type,
      size: arrayBuffer.byteLength,
      buffer: Buffer.from(arrayBuffer)
    };

    logger.debug('Processing file for vision', {
      fileName,
      originalSize: file.size,
      type: file.type
    });

    // Process file (handle HEIC conversion, video frame extraction)
    const processedFile = await processFileForVision(file);
    const processedBuffer = processedFile.buffer;
    
    logger.debug('Processed file details', {
      originalFileName: fileName,
      processedFileName: processedFile.name,
      processedFileType: processedFile.type,
      bufferLength: processedBuffer.length
    });

    // Generate optimized versions
    logger.debug('Generating optimized versions');
    
    const [fullSizeBuffer, thumbnailBuffer] = await Promise.all([
      optimizeImage(processedBuffer, true),
      optimizeImage(processedBuffer, false)
    ]);

    // Generate UUID and filenames
    const uuid = require('crypto').randomUUID();
    const filename = `${uuid}.jpg`;
    const fullSizeFilename = generateOptimizedFilename(uuid, true);
    const thumbnailFilename = generateOptimizedFilename(uuid, false);

    logger.debug('Uploading optimized files', {
      uuid,
      filename,
      fullSizeFilename,
      thumbnailFilename,
      fullSizeSize: fullSizeBuffer.length,
      thumbnailSize: thumbnailBuffer.length
    });

    // Upload both versions
    await Promise.all([
      uploadOptimizedFile(supabase, fullSizeBuffer, fullSizeFilename),
      uploadOptimizedFile(supabase, thumbnailBuffer, thumbnailFilename)
    ]);

    const response = {
      success: true,
      uuid: uuid,
      filename: filename
    };

    logger.info('Image optimization completed successfully', {
      originalPath: original_path,
      uuid: uuid,
      filename: filename,
      fullSizePath: fullSizeFilename,
      thumbnailPath: thumbnailFilename,
      originalSize: file.size,
      fullSizeSize: fullSizeBuffer.length,
      thumbnailSize: thumbnailBuffer.length,
      compressionRatio: Math.round((1 - (fullSizeBuffer.length + thumbnailBuffer.length) / file.size) * 100)
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response)
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.logError(error instanceof Error ? error : new Error(String(error)), 'Image optimization failed');
    
    const response = {
      success: false,
      error: errorMessage
    };

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(response)
    };
  }
};
