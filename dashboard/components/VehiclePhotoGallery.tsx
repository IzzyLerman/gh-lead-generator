'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import { Tables } from '@/types/database'
import { getSignedImageUrl, triggerImageDownload, openImageInNewTab } from '@/lib/image-utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Download, ExternalLink, Eye, Loader2 } from 'lucide-react'
import { createLogger } from '@/utils/logger'

interface VehiclePhotoGalleryProps {
  photos: Tables<'vehicle-photos'>[]
  companyName: string
}

interface PhotoWithUrl extends Tables<'vehicle-photos'> {
  signedUrl?: string | null
  loading?: boolean
  error?: boolean
}

export function VehiclePhotoGallery({ photos, companyName }: VehiclePhotoGalleryProps) {
  const [photosWithUrls, setPhotosWithUrls] = useState<PhotoWithUrl[]>([])
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoWithUrl | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const logger = createLogger('vehicle-photo-gallery')

  useEffect(() => {
    if (photos.length === 0) return

    const loadPhotos = async () => {
      const initialPhotos: PhotoWithUrl[] = photos.map(photo => ({
        ...photo,
        loading: true,
        error: false
      }))
      setPhotosWithUrls(initialPhotos)

      const updatedPhotos = await Promise.all(
        photos.map(async (photo) => {
          if (!photo.name) {
            return { ...photo, loading: false, error: true }
          }

          try {
            const signedUrl = await getSignedImageUrl(photo.name)
            return {
              ...photo,
              signedUrl,
              loading: false,
              error: !signedUrl
            }
          } catch (error) {
            logger.logError(error as Error, 'Failed to load photo', { photoName: photo.name })
            return { ...photo, loading: false, error: true }
          }
        })
      )

      setPhotosWithUrls(updatedPhotos)
    }

    loadPhotos()
  }, [photos, logger])

  const handlePhotoClick = (photo: PhotoWithUrl) => {
    setSelectedPhoto(photo)
    setModalOpen(true)
  }

  const handleDownload = (photo: PhotoWithUrl) => {
    if (photo.name) {
      const fileName = `${companyName.replace(/[^a-z0-9]/gi, '_')}_${photo.name}`
      triggerImageDownload(photo.name, fileName)
    }
  }

  const handleOpenInNewTab = (photo: PhotoWithUrl) => {
    if (photo.name) {
      openImageInNewTab(photo.name)
    }
  }

  if (photos.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No photos available
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {photosWithUrls.map((photo) => (
          <div key={photo.id} className="relative group">
            <div className="w-16 h-16 rounded-lg overflow-hidden border border-border bg-muted">
              {photo.loading && (
                <div className="w-full h-full flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
              {photo.error && !photo.loading && (
                <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
                  📷
                </div>
              )}
              {photo.signedUrl && !photo.loading && !photo.error && (
                <Image
                  src={photo.signedUrl}
                  alt={`Vehicle photo for ${companyName}`}
                  width={64}
                  height={64}
                  className="w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => handlePhotoClick(photo)}
                />
              )}
            </div>
            
            {photo.signedUrl && !photo.loading && !photo.error && (
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-white hover:bg-white/20"
                  onClick={() => handlePhotoClick(photo)}
                >
                  <Eye className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-white hover:bg-white/20"
                  onClick={() => handleOpenInNewTab(photo)}
                >
                  <ExternalLink className="h-3 w-3" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 text-white hover:bg-white/20"
                  onClick={() => handleDownload(photo)}
                >
                  <Download className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Vehicle Photo - {companyName}</DialogTitle>
          </DialogHeader>
          {selectedPhoto?.signedUrl && (
            <div className="flex flex-col items-center gap-4">
              <div className="relative max-w-full max-h-[70vh] overflow-hidden rounded-lg">
                <Image
                  src={selectedPhoto.signedUrl}
                  alt={`Vehicle photo for ${companyName}`}
                  width={800}
                  height={600}
                  className="w-auto h-auto max-w-full max-h-full object-contain"
                />
              </div>
              {selectedPhoto.location && (
                <div className="text-center text-sm text-muted-foreground">
                  <strong>Location:</strong> {selectedPhoto.location}
                </div>
              )}
              {selectedPhoto.submitted_by && (
                <div className="text-center text-sm text-muted-foreground">
                  <strong>Submitted by:</strong> {selectedPhoto.submitted_by}
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  onClick={() => handleOpenInNewTab(selectedPhoto)}
                  variant="outline"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in New Tab
                </Button>
                <Button
                  onClick={() => handleDownload(selectedPhoto)}
                  variant="outline"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}