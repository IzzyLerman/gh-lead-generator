import { createClient } from '@/utils/supabase/client'
import { Tables } from '@/types/database'

const BUCKET_NAME = 'gh-vehicle-photos'

export async function getSignedImageUrl(fileName: string): Promise<string | null> {
  const supabase = createClient()
  
  try {
    console.log('Getting signed URL for:', fileName)
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .createSignedUrl(fileName, 60 * 60) // 1 hour expiry

    if (error) {
      console.error('Error creating signed URL:', error)
      console.error('Error details:', JSON.stringify(error, null, 2))
      return null
    }

    if (!data?.signedUrl) {
      console.error('No signed URL returned for:', fileName)
      return null
    }

    console.log('Successfully created signed URL for:', fileName)
    return data.signedUrl
  } catch (error) {
    console.error('Error in getSignedImageUrl:', error)
    console.error('Error stack:', error)
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
  
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(fileName)

    if (error) {
      console.error('Error downloading image:', error)
      return null
    }

    return data
  } catch (error) {
    console.error('Error in downloadImage:', error)
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
  try {
    const signedUrl = await getSignedImageUrl(fileName)
    if (!signedUrl) {
      console.error('Failed to get signed URL for download')
      return
    }

    const response = await fetch(signedUrl)
    if (!response.ok) {
      console.error('Failed to fetch image for download')
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
    console.error('Error downloading image:', error)
  }
}

export function openImageInNewTab(fileName: string) {
  getSignedImageUrl(fileName).then(signedUrl => {
    if (signedUrl) {
      window.open(signedUrl, '_blank')
    } else {
      console.error('Failed to get signed URL for new tab')
    }
  })
}