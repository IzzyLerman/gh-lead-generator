import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
} from "npm:@imagemagick/magick-wasm@0.0.30";
import { Database } from './../_shared/database.types.ts';
import { createLogger } from './../_shared/logger.ts';
import { Buffer } from 'node:buffer';
import ExifReader from 'https://esm.sh/exifreader@4';
import fileType from 'https://esm.sh/file-type@16.5.4';

const BUCKET_NAME = "gh-vehicle-photos";
const THUMBNAIL_MAX_SIZE = 200;
const FULL_SIZE_QUALITY = 80;
const THUMBNAIL_QUALITY = 50;

const logger = createLogger('upload-optimized-images');

function getEnvVar(key: string): string {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`Missing environment variable: ${key}`);
  return value;
}

// Initialize ImageMagick
const wasmBytes = await Deno.readFile(
  new URL(
    "magick.wasm",
    import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.30"),
  ),
);
await initializeImageMagick(wasmBytes);

interface CloudinaryUploadResponse {
  public_id: string;
  version: number;
  signature: string;
  width: number;
  height: number;
  format: string;
  resource_type: string;
  created_at: string;
  tags: string[];
  bytes: number;
  type: string;
  etag: string;
  placeholder: boolean;
  url: string;
  secure_url: string;
  access_mode: string;
  original_filename: string;
}

async function generateSignature(params: Record<string, string | number>, apiSecret: string): Promise<string> {
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  
  const encoder = new TextEncoder();
  const data = encoder.encode(sortedParams + apiSecret);
  
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function uploadToCloudinary(videoFile: File): Promise<CloudinaryUploadResponse> {
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
  formData.append('file', videoFile);
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

  const result = await response.json() as CloudinaryUploadResponse;
  logger.debug('Cloudinary upload successful', {
    publicId: result.public_id,
    format: result.format,
    bytes: result.bytes
  });
  
  return result;
}

async function destroyCloudinaryResource(publicId: string, resourceType: 'image' | 'video' = 'video'): Promise<void> {
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

async function convertHeicToJpg(heicFile: File, inputBuffer?: Uint8Array): Promise<File> {
  try {
    logger.debug('Starting HEIC to JPG conversion', {
      filename: heicFile.name,
      originalSize: heicFile.size,
      fileType: heicFile.type
    });
    
    let bufferToUse: Uint8Array;
    if (inputBuffer) {
      bufferToUse = inputBuffer;
    } else {
      bufferToUse = new Uint8Array(await heicFile.arrayBuffer());
    }
    
    const nodeBuffer = Buffer.from(bufferToUse);
    
    // @ts-ignore: heic-convert doesn't have type definitions
    const convert = (await import('npm:heic-convert@2.1.0')).default;
    
    const jpegBuffer = await convert({
      buffer: nodeBuffer,
      format: 'JPEG',
      quality: 0.9
    });
    
    const filename = heicFile.name.replace(/\.heic$/i, '.jpg');
    const convertedFile = new File([jpegBuffer], filename, { type: 'image/jpeg' });
    
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

async function extractVideoFrameFromCloudinary(videoFile: File): Promise<File> {
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
    
    const frameBlob = await response.blob();
    
    const filename = videoFile.name.replace(/\.(mp4|mov)$/i, '.jpg');
    const resultFile = new File([frameBlob], filename, { type: 'image/jpeg' });
    
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

async function processFileForVision(file: File, fileBuffer?: Uint8Array): Promise<File> {
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

function generateOptimizedFilename(uuid: string, isFullSize: boolean = true): string {
  const folder = isFullSize ? "uploads" : "thumbnails";
  return `${folder}/${uuid}.jpg`;
}

async function optimizeImage(imageBuffer: Uint8Array, isFullSize: boolean): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    try {
      logger.debug('Starting ImageMagick.read', {
        bufferLength: imageBuffer.length,
        isUint8Array: imageBuffer instanceof Uint8Array,
        isFullSize
      });
      
      ImageMagick.read(imageBuffer, (image) => {
        try {
          logger.debug('Inside ImageMagick callback', {
            width: image.width,
            height: image.height
          });
          
          if (!isFullSize) {
            // For thumbnails, resize to fit within max dimensions
            const width = image.width;
            const height = image.height;
            
            if (width > THUMBNAIL_MAX_SIZE || height > THUMBNAIL_MAX_SIZE) {
              const ratio = Math.min(THUMBNAIL_MAX_SIZE / width, THUMBNAIL_MAX_SIZE / height);
              const newWidth = Math.round(width * ratio);
              const newHeight = Math.round(height * ratio);
              
              logger.debug('Resizing thumbnail', {
                originalSize: `${width}x${height}`,
                newSize: `${newWidth}x${newHeight}`,
                ratio
              });
              
              // Use simple resize like in the docs
              image.resize(newWidth, newHeight);
            }
          }
          
          logger.debug('About to write image');
          
          // Write as JPEG format like in the docs example
          image.write(MagickFormat.Jpeg, (data) => {
            logger.debug('Image write completed', { 
              outputLength: data.length 
            });
            resolve(data);
          });
        } catch (error) {
          logger.error('Error in ImageMagick callback', { 
            error: error instanceof Error ? error.message : String(error) 
          });
          reject(error);
        }
      });
    } catch (error) {
      logger.error('Error calling ImageMagick.read', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      reject(error);
    }
  });
}

async function uploadOptimizedFile(
  supabase: SupabaseClient<Database>, 
  imageBuffer: Uint8Array, 
  filename: string
): Promise<any> {
  logger.debug('Uploading optimized file', {
    filename,
    size: imageBuffer.length
  });
  
  const file = new File([imageBuffer], filename, { type: 'image/jpeg' });
  
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filename, file, {
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

interface OptimizationRequest {
  original_path: string;
}

interface OptimizationResponse {
  success: boolean;
  uuid?: string;
  filename?: string;
  error?: string;
}

export const handler = async (req: Request): Promise<Response> => {
  logger.info('Upload optimized images function started', {
    method: req.method
  });

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const { original_path }: OptimizationRequest = await req.json();
    
    if (!original_path) {
      return new Response(
        JSON.stringify({ success: false, error: "original_path is required" }),
        { 
          status: 400, 
          headers: { "Content-Type": "application/json" } 
        }
      );
    }

    const SUPABASE_SERVICE_ROLE_KEY = getEnvVar("SUPABASE_SERVICE_ROLE_KEY");
    const SUPABASE_URL = getEnvVar("SUPABASE_URL");

    const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
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

    // Convert to File object for processing
    const arrayBuffer = await originalFile.arrayBuffer();
    const fileName = original_path.split('/').pop() || 'unknown';
    const file = new File([arrayBuffer], fileName, { type: originalFile.type });

    logger.debug('Processing file for vision', {
      fileName,
      originalSize: file.size,
      type: file.type
    });

    // Process file (handle HEIC conversion, video frame extraction)
    const processedFile = await processFileForVision(file);
    const processedBuffer = new Uint8Array(await processedFile.arrayBuffer());
    
    logger.debug('Processed file details', {
      originalFileName: fileName,
      processedFileName: processedFile.name,
      processedFileType: processedFile.type,
      bufferLength: processedBuffer.length,
      bufferConstructor: processedBuffer.constructor.name
    });

    // Generate optimized versions
    logger.debug('Generating optimized versions');
    
    const [fullSizeBuffer, thumbnailBuffer] = await Promise.all([
      optimizeImage(processedBuffer, true),
      optimizeImage(processedBuffer, false)
    ]);

    // Generate UUID and filenames
    const uuid = crypto.randomUUID();
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

    const response: OptimizationResponse = {
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

    return new Response(JSON.stringify(response), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.logError(error instanceof Error ? error : new Error(String(error)), 'Image optimization failed');
    
    const response: OptimizationResponse = {
      success: false,
      error: errorMessage
    };

    return new Response(JSON.stringify(response), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

Deno.serve(handler);