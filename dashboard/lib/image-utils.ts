import { createClient } from '@/utils/supabase/client'
import { Tables } from '@/types/database'
import { createLogger } from '@/utils/logger'

const BUCKET_NAME = 'gh-vehicle-photos'

export async function getThumbnailImageUrl(fileName: string): Promise<string | null> {
  const supabase = createClient()
  const logger = createLogger('image-utils')
  
  try {
    const possiblePaths: string[] = []
    
    // Handle full path format (uploads/vehicle_uuid.jpg)
    if (fileName.startsWith('uploads/')) {
      const baseFileName = fileName.split('/').pop() || fileName
      // Extract UUID from vehicle_uuid.jpg format and use it for thumbnail
      const uuidMatch = baseFileName.match(/vehicle_([a-f0-9-]{36})\.(jpg|jpeg|png|webp)/i)
      if (uuidMatch) {
        possiblePaths.push(`thumbnails/${uuidMatch[1]}.jpg`)
      }
      // Try both vehicle_ prefix and direct filename
      possiblePaths.push(`thumbnails/vehicle_${baseFileName}`)
      possiblePaths.push(`thumbnails/${baseFileName}`)
    } else if (fileName.startsWith('vehicle_')) {
      // Handle legacy vehicle_uuid.jpg format
      const uuidMatch = fileName.match(/vehicle_([a-f0-9-]{36})\.(jpg|jpeg|png|webp)/i)
      if (uuidMatch) {
        possiblePaths.push(`thumbnails/${uuidMatch[1]}.jpg`)
      }
      possiblePaths.push(`thumbnails/${fileName}`)
    } else {
      // Handle other formats - try with vehicle_ prefix first, then direct
      possiblePaths.push(`thumbnails/vehicle_${fileName}`)
      possiblePaths.push(`thumbnails/${fileName}`)
    }
    
    // Try each possible path until we find one that works
    for (const thumbnailPath of possiblePaths) {
      logger.debug('Trying thumbnail path', { fileName, thumbnailPath })
      
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .createSignedUrl(thumbnailPath, 60 * 60) // 1 hour expiry

      if (!error && data?.signedUrl) {
        logger.debug('Successfully created thumbnail signed URL', { fileName, thumbnailPath })
        return data.signedUrl
      }
      
      logger.debug('Thumbnail path failed, trying next', { fileName, thumbnailPath, error: error?.message })
    }

    logger.error('No thumbnail found for any path', { fileName, possiblePaths })
    return null
  } catch (error) {
    logger.logError(error as Error, 'Error in getThumbnailImageUrl', { fileName })
    return null
  }
}

export async function getSignedImageUrl(fileName: string): Promise<string | null> {
  const supabase = createClient()
  const logger = createLogger('image-utils')
  
  try {
    let fullSizePath: string
    
    // Handle full path format (uploads/vehicle_uuid.jpg) - use as-is
    if (fileName.startsWith('uploads/')) {
      fullSizePath = fileName
    } else if (fileName.startsWith('vehicle_')) {
      // Handle legacy vehicle_uuid.jpg format
      const uuidMatch = fileName.match(/vehicle_([a-f0-9-]{36})\.(jpg|jpeg|png|webp)/i)
      if (uuidMatch) {
        fullSizePath = `uploads/${uuidMatch[1]}.jpg`
      } else {
        // Fallback: add uploads/ prefix
        fullSizePath = `uploads/${fileName}`
      }
    } else {
      // Handle other formats (direct UUID or legacy)
      fullSizePath = `uploads/${fileName}`
    }
    
    logger.debug('Getting signed URL for full-size image', { fileName, fullSizePath })
    
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(fullSizePath, 60 * 60) // 1 hour expiry

    if (error) {
      logger.logError(error, 'Error creating signed URL', { fileName, fullSizePath })
      return null
    }

    if (!data?.signedUrl) {
      logger.error('No signed URL returned', { fileName, fullSizePath })
      return null
    }

    logger.debug('Successfully created signed URL', { fileName, fullSizePath })
    return data.signedUrl
  } catch (error) {
    logger.logError(error as Error, 'Error in getSignedImageUrl', { fileName })
    return null
  }
}

export async function getPublicImageUrl(fileName: string): Promise<string> {
  const supabase = createClient()
  
  // Handle full path format or add uploads/ prefix
  const fullSizePath = fileName.startsWith('uploads/') ? fileName : `uploads/${fileName}`
  const { data } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(fullSizePath)
  
  return data.publicUrl
}

export async function downloadImage(fileName: string): Promise<Blob | null> {
  const supabase = createClient()
  const logger = createLogger('image-utils')
  
  try {
    // Handle full path format or add uploads/ prefix
    const fullSizePath = fileName.startsWith('uploads/') ? fileName : `uploads/${fileName}`
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(fullSizePath)

    if (error) {
      logger.logError(error, 'Error downloading image', { fileName, fullSizePath })
      return null
    }

    return data
  } catch (error) {
    logger.logError(error as Error, 'Error in downloadImage', { fileName })
    return null
  }
}

export function getDownloadFileName(vehiclePhoto: Tables<'vehicle-photos'>): string {
  if (vehiclePhoto.name) {
    return vehiclePhoto.name
  }
  
  return `vehicle-photo-${vehiclePhoto.id}.jpg`
}

export async function triggerImageDownload(fileName: string, displayName?: string) {
  const logger = createLogger('image-utils')
  
  try {
    const signedUrl = await getSignedImageUrl(fileName)
    if (!signedUrl) {
      logger.error('Failed to get signed URL for download', { fileName })
      return
    }

    const response = await fetch(signedUrl)
    if (!response.ok) {
      logger.error('Failed to fetch image for download', { fileName, status: response.status })
      return
    }

    const blob = await response.blob()
    const url = window.URL.createObjectURL(blob)
    
    const link = document.createElement('a')
    link.href = url
    link.download = displayName || fileName
    document.body.appendChild(link)
    link.click()
    
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  } catch (error) {
    logger.logError(error as Error, 'Error downloading image', { fileName, displayName })
  }
}

export function openImageInNewTab(fileName: string) {
  const logger = createLogger('image-utils')
  
  getSignedImageUrl(fileName).then(signedUrl => {
    if (signedUrl) {
      window.open(signedUrl, '_blank')
    } else {
      logger.error('Failed to get signed URL for new tab', { fileName })
    }
  })
}