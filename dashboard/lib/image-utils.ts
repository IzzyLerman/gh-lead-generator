import { createClient } from '@/utils/supabase/client'
import { Tables } from '@/types/database'
import { createLogger } from '@/utils/logger'

const BUCKET_NAME = 'gh-vehicle-photos'

export async function getSignedImageUrl(fileName: string): Promise<string | null> {
  const supabase = createClient()
  const logger = createLogger('image-utils')
  
  try {
    logger.debug('Getting signed URL for image', { fileName })
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(fileName, 60 * 60) // 1 hour expiry

    if (error) {
      logger.logError(error, 'Error creating signed URL', { fileName })
      return null
    }

    if (!data?.signedUrl) {
      logger.error('No signed URL returned', { fileName })
      return null
    }

    logger.debug('Successfully created signed URL', { fileName })
    return data.signedUrl
  } catch (error) {
    logger.logError(error as Error, 'Error in getSignedImageUrl', { fileName })
    return null
  }
}

export async function getPublicImageUrl(fileName: string): Promise<string> {
  const supabase = createClient()
  
  const { data } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(fileName)
  
  return data.publicUrl
}

export async function downloadImage(fileName: string): Promise<Blob | null> {
  const supabase = createClient()
  const logger = createLogger('image-utils')
  
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(fileName)

    if (error) {
      logger.logError(error, 'Error downloading image', { fileName })
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