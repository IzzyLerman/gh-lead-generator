'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useQuery } from '@tanstack/react-query'
import { Tables } from '@/types/database'
import { getSignedImageUrl, getThumbnailImageUrl, triggerImageDownload, openImageInNewTab } from '@/lib/image-utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Download, ExternalLink, Eye, Loader2 } from 'lucide-react'
import { createLogger } from '@/utils/logger'

interface VehiclePhotoGalleryProps {
  photos: Tables<'vehicle-photos'>[]
  companyName: string
}

// Hook for getting thumbnail URL with React Query caching
function useThumbnailUrl(photoName: string | null) {
  return useQuery({
    queryKey: ['thumbnail', photoName],
    queryFn: () => photoName ? getThumbnailImageUrl(photoName) : null,
    enabled: !!photoName,
    staleTime: Infinity, // Never consider stale since images never change
    gcTime: Infinity, // Never garbage collect (was cacheTime in older versions)
  })
}

// Hook for getting full-size URL with React Query caching
function useFullSizeUrl(photoName: string | null) {
  return useQuery({
    queryKey: ['fullsize', photoName],
    queryFn: () => photoName ? getSignedImageUrl(photoName) : null,
    enabled: !!photoName,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

// Individual photo component to handle its own loading
function PhotoThumbnail({ photo, companyName, onClick }: { 
  photo: Tables<'vehicle-photos'>; 
  companyName: string; 
  onClick: () => void;
}) {
  const { data: thumbnailUrl, isLoading, error } = useThumbnailUrl(photo.name)
  
  return (
    <div className="relative group">
      <div className="w-16 h-16 rounded-lg overflow-hidden border border-border bg-muted">
        {isLoading && (
          <div className="w-full h-full flex items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        {error && !isLoading && (
          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">
            📷
          </div>
        )}
        {thumbnailUrl && !isLoading && !error && (
          <Image
            src={thumbnailUrl}
            alt={`Vehicle photo for ${companyName}`}
            width={64}
            height={64}
            className="w-full h-full object-cover cursor-pointer hover:opacity-80 transition-opacity"
            onClick={onClick}
          />
        )}
      </div>
      
      {thumbnailUrl && !isLoading && !error && (
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-white hover:bg-white/20"
            onClick={onClick}
          >
            <Eye className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-white hover:bg-white/20"
            onClick={() => openImageInNewTab(photo.name!)}
          >
            <ExternalLink className="h-3 w-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0 text-white hover:bg-white/20"
            onClick={() => {
              if (photo.name) {
                const fileExtension = photo.name.split('.').pop() || 'webp'
                const fileName = `${companyName.replace(/[^a-z0-9]/gi, '_')}.${fileExtension}`
                triggerImageDownload(photo.name, fileName)
              }
            }}
          >
            <Download className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  )
}

// Modal component that loads full-size image only when opened
function PhotoModal({ photo, companyName, isOpen, onClose }: {
  photo: Tables<'vehicle-photos'> | null;
  companyName: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { data: fullSizeUrl, isLoading } = useFullSizeUrl(photo?.name || null)
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>Vehicle Photo - {companyName}</DialogTitle>
        </DialogHeader>
        {photo && (
          <div className="flex flex-col items-center gap-4">
            <div className="relative max-w-full max-h-[70vh] overflow-hidden rounded-lg">
              {isLoading && (
                <div className="w-full h-64 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              )}
              {fullSizeUrl && !isLoading && (
                <Image
                  src={fullSizeUrl}
                  alt={`Vehicle photo for ${companyName}`}
                  width={800}
                  height={600}
                  className="w-auto h-auto max-w-full max-h-full object-contain"
                />
              )}
            </div>
            {photo.location && (
              <div className="text-center text-sm text-muted-foreground">
                <strong>Location:</strong> {photo.location}
              </div>
            )}
            {photo.submitted_by && (
              <div className="text-center text-sm text-muted-foreground">
                <strong>Submitted by:</strong> {photo.submitted_by}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                onClick={() => openImageInNewTab(photo.name!)}
                variant="outline"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in New Tab
              </Button>
              <Button
                onClick={() => {
                  if (photo.name) {
                    const fileExtension = photo.name.split('.').pop() || 'webp'
                    const fileName = `${companyName.replace(/[^a-z0-9]/gi, '_')}.${fileExtension}`
                    triggerImageDownload(photo.name, fileName)
                  }
                }}
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
  )
}

export function VehiclePhotoGallery({ photos, companyName }: VehiclePhotoGalleryProps) {
  const [selectedPhoto, setSelectedPhoto] = useState<Tables<'vehicle-photos'> | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const handlePhotoClick = (photo: Tables<'vehicle-photos'>) => {
    setSelectedPhoto(photo)
    setModalOpen(true)
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
        {photos.map((photo) => (
          <PhotoThumbnail
            key={photo.id}
            photo={photo}
            companyName={companyName}
            onClick={() => handlePhotoClick(photo)}
          />
        ))}
      </div>

      <PhotoModal
        photo={selectedPhoto}
        companyName={companyName}
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  )
}