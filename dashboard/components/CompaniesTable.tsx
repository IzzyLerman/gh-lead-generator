'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { ChevronRight, ChevronDown, Mail, Phone, MapPin, Building, Download, HelpCircle, Globe, DollarSign, Hash, Send } from 'lucide-react'
import { CompanyWithContactsAndPhotos, PaginatedResult } from '@/lib/server-utils'
import { fetchCompaniesWithContactsAndPhotos } from '@/lib/client-utils'
import { VehiclePhotoGallery } from './VehiclePhotoGallery'
import { Tables } from '@/types/database'
import { Pagination } from '@/components/ui/pagination'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { createLogger } from '@/utils/logger'

interface CompaniesTableProps {
  initialData?: PaginatedResult<CompanyWithContactsAndPhotos>
}

export default function CompaniesTable({ initialData }: CompaniesTableProps) {
  const [paginatedData, setPaginatedData] = useState<PaginatedResult<CompanyWithContactsAndPhotos>>(
    initialData || { data: [], totalCount: 0, totalPages: 0, currentPage: 1, pageSize: 8 }
  )
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set())
  const [isExporting, setIsExporting] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const supabase = createClient()
  const logger = createLogger('companies-table')

  // Component logging
  logger.component('CompaniesTable', 'mounted', {
    initialDataLength: paginatedData.data.length,
    totalCount: paginatedData.totalCount
  })

  const handlePageChange = useCallback(async (page: number) => {
    setIsLoading(true)
    try {
      const result = await fetchCompaniesWithContactsAndPhotos({ page, pageSize: 8 })
      setPaginatedData(result)
      setExpandedCompanies(new Set()) // Clear expanded state when changing pages
    } catch (error) {
      logger.logError(error as Error, 'Error fetching page data', { page, pageSize: 8 })
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    logger.debug('Setting up realtime subscription')
    const channel = supabase
      .channel('dashboard-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'companies' },
        (payload) => {
          logger.debug('Company change detected', { 
            eventType: payload.eventType,
            companyId: (payload.new as Tables<'companies'>)?.id || (payload.old as Tables<'companies'>)?.id
          })
          
          if (payload.eventType === 'INSERT') {
            // For new companies, refresh the current page if we're on page 1
            setPaginatedData(prev => {
              if (prev.currentPage === 1) {
                handlePageChange(1)
              }
              return prev
            })
          } else if (payload.eventType === 'UPDATE') {
            const updatedCompany = payload.new as Tables<'companies'>
            setPaginatedData(prev => ({
              ...prev,
              data: prev.data.map(company => 
                company.id === updatedCompany.id 
                  ? { ...updatedCompany, contacts: company.contacts, 'vehicle-photos': company['vehicle-photos'] }
                  : company
              )
            }))
          } else if (payload.eventType === 'DELETE') {
            const deletedId = payload.old.id
            setPaginatedData(prev => ({
              ...prev,
              data: prev.data.filter(company => company.id !== deletedId)
            }))
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contacts' },
        (payload) => {
          logger.debug('Contact change detected', {
            eventType: payload.eventType,
            contactId: (payload.new as Tables<'contacts'>)?.id || (payload.old as Tables<'contacts'>)?.id
          })
          
          if (payload.eventType === 'INSERT') {
            const newContact = payload.new as Tables<'contacts'>
            setPaginatedData(prev => ({
              ...prev,
              data: prev.data.map(company => 
                company.id.toString() === newContact.company_id
                  ? { ...company, contacts: [...company.contacts, newContact] }
                  : company
              )
            }))
          } else if (payload.eventType === 'UPDATE') {
            const updatedContact = payload.new as Tables<'contacts'>
            console.log('Realtime contact UPDATE received:', { 
              contactId: updatedContact.id,
              newStatus: updatedContact.status,
              companyId: updatedContact.company_id 
            })
            setPaginatedData(prev => ({
              ...prev,
              data: prev.data.map(company => 
                company.id.toString() === updatedContact.company_id
                  ? { 
                      ...company, 
                      contacts: company.contacts.map(contact => 
                        contact.id === updatedContact.id ? updatedContact : contact
                      )
                    }
                  : company
              )
            }))
          } else if (payload.eventType === 'DELETE') {
            const deletedContact = payload.old as Tables<'contacts'>
            setPaginatedData(prev => ({
              ...prev,
              data: prev.data.map(company => 
                company.id.toString() === deletedContact.company_id
                  ? { 
                      ...company, 
                      contacts: company.contacts.filter(contact => contact.id !== deletedContact.id)
                    }
                  : company
              )
            }))
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vehicle-photos' },
        (payload) => {
          logger.debug('Vehicle photo change detected', {
            eventType: payload.eventType,
            photoId: (payload.new as Tables<'vehicle-photos'>)?.id || (payload.old as Tables<'vehicle-photos'>)?.id,
            companyId: (payload.new as Tables<'vehicle-photos'>)?.company_id || (payload.old as Tables<'vehicle-photos'>)?.company_id
          })
          
          if (payload.eventType === 'INSERT') {
            const newPhoto = payload.new as Tables<'vehicle-photos'>
            setPaginatedData(prev => ({
              ...prev,
              data: prev.data.map(company => 
                company.id === newPhoto.company_id
                  ? { ...company, 'vehicle-photos': [...company['vehicle-photos'], newPhoto] }
                  : company
              )
            }))
          } else if (payload.eventType === 'UPDATE') {
            const updatedPhoto = payload.new as Tables<'vehicle-photos'>
            setPaginatedData(prev => ({
              ...prev,
              data: prev.data.map(company => 
                company.id === updatedPhoto.company_id
                  ? { 
                      ...company, 
                      'vehicle-photos': company['vehicle-photos'].map(photo => 
                        photo.id === updatedPhoto.id ? updatedPhoto : photo
                      )
                    }
                  : company
              )
            }))
          } else if (payload.eventType === 'DELETE') {
            const deletedPhoto = payload.old as Tables<'vehicle-photos'>
            setPaginatedData(prev => ({
              ...prev,
              data: prev.data.map(company => 
                company.id === deletedPhoto.company_id
                  ? { 
                      ...company, 
                      'vehicle-photos': company['vehicle-photos'].filter(photo => photo.id !== deletedPhoto.id)
                    }
                  : company
              )
            }))
          }
        }
      )
      .subscribe((status) => {
        logger.debug('Realtime subscription status changed', { status })
        if (status === 'SUBSCRIBED') {
          logger.info('Successfully subscribed to realtime changes')
        } else if (status === 'CHANNEL_ERROR') {
          logger.error('Realtime subscription error', { status })
        } else if (status === 'TIMED_OUT') {
          logger.error('Realtime subscription timed out', { status })
        } else if (status === 'CLOSED') {
          logger.info('Realtime subscription closed', { status })
        }
      })

    return () => {
      logger.debug('Cleaning up realtime subscription')
      supabase.removeChannel(channel)
    }
  }, [])

  const toggleExpand = (companyId: string) => {
    setExpandedCompanies(prev => {
      const newSet = new Set(prev)
      if (newSet.has(companyId)) {
        newSet.delete(companyId)
      } else {
        newSet.add(companyId)
      }
      return newSet
    })
  }

  const formatArray = (arr: string[] | null) => {
    if (!arr || arr.length === 0) return '-'
    return arr.join(', ')
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleDateString()
  }

  const formatFullName = (firstName: string | null, middleName: string | null, lastName: string | null) => {
    const nameParts = [firstName, middleName, lastName].filter(part => part && part.trim())
    return nameParts.length > 0 ? nameParts.join(' ') : 'Unnamed Contact'
  }

  const formatSubmittedBy = (photos: Tables<'vehicle-photos'>[]) => {
    const uniqueSubmitters = Array.from(
      new Set(
        photos
          .map(photo => photo.submitted_by)
          .filter(submitter => submitter && submitter.trim())
      )
    ).slice(0, 5)
    
    return uniqueSubmitters.length > 0 ? uniqueSubmitters.join(', ') : '-'
  }

  const formatRevenue = (revenue: number | null) => {
    if (!revenue) return '-'
    return `$${revenue.toLocaleString()}`
  }

  const formatCodes = (codes: string | null) => {
    if (!codes || codes.trim() === '') return '-'
    return codes
  }

  const sortContactsByStatus = (contacts: Tables<'contacts'>[]) => {
    const statusOrder = {
      'ready_to_send': 1,
      'sent': 2,
      'do_not_contact': 3,
      'no_contact': 4,
      'failed': 5,
      'non-executive': 6,
      'generating_message': 7
    }
    
    return [...contacts].sort((a, b) => {
      const aOrder = statusOrder[a.status as keyof typeof statusOrder] || 99
      const bOrder = statusOrder[b.status as keyof typeof statusOrder] || 99
      return aOrder - bOrder
    })
  }

  const downloadCSV = (csvContent: string, filename: string) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', filename)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleExportCompanies = async () => {
    setIsExporting('companies')
    try {
      const { data, error } = await supabase.schema('private').rpc('export_companies_csv')
      
            
      if (error) {
        logger.logError(error, 'Supabase error during companies export')
        throw error
      }
      
      if (!data) {
        throw new Error('No data returned from export function')
      }
      
      const timestamp = new Date().toISOString().split('T')[0]
      downloadCSV(data, `companies-${timestamp}.csv`)
    } catch (error) {
      logger.logError(error as Error, 'Error exporting companies')
      alert(`Failed to export companies: ${(error as Error)?.message || 'Unknown error'}`)
    } finally {
      setIsExporting(null)
    }
  }

  const handleExportContacts = async () => {
    setIsExporting('contacts')
    try {
      const { data, error } = await supabase.schema('private').rpc('export_contacts_csv')
      
      if (error) {
        logger.logError(error, 'Supabase error during contacts export')
        throw error
      }
      
      if (!data) {
        throw new Error('No data returned from export function')
      }
      
      const timestamp = new Date().toISOString().split('T')[0]
      downloadCSV(data, `contacts-${timestamp}.csv`)
    } catch (error) {
      logger.logError(error as Error, 'Error exporting contacts')
      alert(`Failed to export contacts: ${(error as Error)?.message || 'Unknown error'}`)
    } finally {
      setIsExporting(null)
    }
  }

  const updateContactStatus = async (contactId: string, newStatus: string) => {
    try {
      alert(`Attempting to update contact ID: ${contactId} status to ${newStatus}`)
      console.log('Update contact status - contactId:', contactId, 'newStatus:', newStatus)
      
      // First, let's check if the contact exists
      const { data: existingContact, error: selectError } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contactId)
        .single()
      
      console.log('Existing contact check:', { existingContact, selectError })
      
      if (selectError) {
        console.error('Contact not found or select error:', selectError)
        alert(`Contact not found: ${selectError.message}`)
        return
      }
      
      const { error, data } = await supabase
        .from('contacts')
        .update({ status: newStatus })
        .eq('id', contactId)
        .select()
      
      console.log('Supabase update result:', { error, data, dataLength: data?.length })
      
      if (error) {
        console.error('Supabase error:', error)
        logger.logError(error, 'Error updating contact status', { contactId, newStatus })
        alert(`Failed to update contact status: ${error.message}`)
      } else if (data && data.length === 0) {
        console.error('No rows updated - possible RLS/permission issue')
        alert(`No rows updated - contact ${contactId} may not be updateable due to permissions`)
      } else {
        console.log('Update successful:', data)
        alert(`Successfully updated contact ${contactId} status to ${newStatus}`)
      }
    } catch (error) {
      console.error('Caught error:', error)
      logger.logError(error as Error, 'Error updating contact status', { contactId, newStatus })
      alert(`Failed to update contact status: ${(error as Error)?.message || 'Unknown error'}`)
    }
  }

  return (
    <div className="space-y-4">
      {/* Export buttons and How to use */}
      <div className="flex justify-between items-center px-6 pt-4">
        <div className="flex gap-2">
          <Button
            onClick={handleExportCompanies}
            disabled={isExporting !== null}
            variant="outline"
          >
            <Download className="h-4 w-4 mr-2" />
            {isExporting === 'companies' ? 'Exporting...' : 'Export Companies to CSV'}
          </Button>
          <Button
            onClick={handleExportContacts}
            disabled={isExporting !== null}
            variant="outline"
          >
            <Download className="h-4 w-4 mr-2" />
            {isExporting === 'contacts' ? 'Exporting...' : 'Export Contacts to CSV'}
          </Button>
        </div>
        
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">
              <HelpCircle className="h-4 w-4 mr-2" />
              How to use
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>How to Use the Dashboard</DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold mb-2">Sending Pictures</h3>
                <p className="text-sm text-muted-foreground">
                  Email up to five images to <a href="mailto:vehicles@izzy.fish" className="text-blue-600 hover:text-blue-800 transition-colors duration-200 hover:underline">vehicles@izzy.fish</a> as attachments. It will accept .jpg, .png, .heic, .mp4, and .mov file types. If you need to submit more than five pictures, message me and I can submit them as a batch.
                </p>
	      </div>
	      <div>
                <h3 className="font-semibold mb-2">Outreach</h3>
		<p className="text-sm text-muted-foreground">
		  For now, I&#39;m doing the outreach manually and updating the statuses accordingly as I send them out.
		</p>
              </div>
              
              <div>
                <h3 className="font-semibold mb-3">Status Key</h3>
                <div className="space-y-3">
                  <div>
                    <h4 className="font-medium text-sm mb-2">Company Statuses</h4>
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                          Enriching
                        </span>
                        <span className="text-sm text-muted-foreground">Processing company data and finding contacts</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Processed
                        </span>
                        <span className="text-sm text-muted-foreground">Company successfully processed with contacts found</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          Not Found
                        </span>
                        <span className="text-sm text-muted-foreground">Company not found in ZoomInfo database</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                          Low Revenue
                        </span>
                        <span className="text-sm text-muted-foreground">Company revenue below minimum threshold</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                          No Execs
                        </span>
                        <span className="text-sm text-muted-foreground">No executive contacts found for this company</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          Contacts Failed
                        </span>
                        <span className="text-sm text-muted-foreground">Error occurred while finding contacts</span>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <h4 className="font-medium text-sm mb-2">Contact Statuses</h4>
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          Ready to Send
                        </span>
                        <span className="text-sm text-muted-foreground">Contact is ready for outreach with personalized message</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                          Sent
                        </span>
                        <span className="text-sm text-muted-foreground">Outreach message has been sent to this contact</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          Do Not Contact
                        </span>
                        <span className="text-sm text-muted-foreground">Contact should not be contacted (opted out or inappropriate)</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                          No Contact
                        </span>
                        <span className="text-sm text-muted-foreground">No email or phone number available for contact</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          Failed
                        </span>
                        <span className="text-sm text-muted-foreground">Error occurred during contact processing</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                          Non-Executive
                        </span>
                        <span className="text-sm text-muted-foreground">Contact is not in an executive role</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          Generating Message
                        </span>
                        <span className="text-sm text-muted-foreground">Automatically generating a personalized outreach message</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              <div>
                <h3 className="font-semibold mb-2">Questions?</h3>
                <p className="text-sm text-muted-foreground">
                  Email me: <a href="mailto:vehicles@izzy.fish" className="text-blue-600 hover:text-blue-800 transition-colors duration-200 hover:underline">izzylerman14@gmail.com</a>
                </p>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-md border">
        <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"></TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Industry</TableHead>
            <TableHead>Website</TableHead>
            <TableHead>Contact Info</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Photos</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Date Created</TableHead>
            <TableHead>Revenue</TableHead>
            <TableHead>Submitted By</TableHead>
            <TableHead>SIC Codes</TableHead>
            <TableHead>NAICS Codes</TableHead>
            <TableHead>Zoominfo ID</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={14} className="text-center py-8">
                Loading...
              </TableCell>
            </TableRow>
          ) : (
            paginatedData.data.map((company) => (
            <React.Fragment key={company.id}>
              <TableRow className="cursor-pointer">
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleExpand(company.id)}
                    className="h-6 w-6 p-0"
                  >
                    {company.contacts.length > 0 && (
                      expandedCompanies.has(company.id) ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )
                    )}
                  </Button>
                </TableCell>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <Building className="h-4 w-4 text-muted-foreground" />
                    {company.name}
                  </div>
                </TableCell>
                <TableCell>{formatArray(company.industry)}</TableCell>
                <TableCell>
                  {company.website ? (
                    <div className="flex items-center gap-1">
                      <Globe className="h-3 w-3 text-muted-foreground" />
                      <a 
                        href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-blue-600 hover:text-blue-800 hover:underline text-sm"
                      >
                        {company.website}
                      </a>
                    </div>
                  ) : (
                    <div className="text-muted-foreground">-</div>
                  )}
                </TableCell>
                <TableCell>
                  <div className="space-y-1 text-sm">
                    {company.email && company.email.length > 0 && (
                      <div className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {company.email[0]}
                      </div>
                    )}
                    {company.phone && company.phone.length > 0 && (
                      <div className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {company.phone[0]}
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-muted-foreground" />
                    {company.city && company.state 
                      ? `${company.city}, ${company.state}${company.zip_code ? ` ${company.zip_code}` : ''}`
                      : company.city || company.state || '-'
                    }
                  </div>
                </TableCell>
                <TableCell>
                  <VehiclePhotoGallery 
                    photos={company['vehicle-photos'] || []} 
                    companyName={company.name}
                  />
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                    company.status === 'enriching' 
                      ? 'bg-yellow-100 text-yellow-800' 
                      : company.status === 'processed'
                      ? 'bg-green-100 text-green-800'
                      : company.status === 'not_found'
                      ? 'bg-gray-100 text-gray-800'
                      : company.status === 'low_revenue'
                      ? 'bg-orange-100 text-orange-800'
                      : company.status === 'no_execs'
                      ? 'bg-purple-100 text-purple-800'
                      : company.status === 'contacts_failed'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {company.status === 'enriching' ? 'Enriching' 
                      : company.status === 'processed' ? 'Processed'
                      : company.status === 'not_found' ? 'Not Found'
                      : company.status === 'low_revenue' ? 'Low Revenue'
                      : company.status === 'no_execs' ? 'No Execs'
                      : company.status === 'contacts_failed' ? 'Contacts Failed'
                      : 'Enriching'}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(company.created_at)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <DollarSign className="h-3 w-3 text-muted-foreground" />
                    <span className="text-sm">{formatRevenue(company.revenue)}</span>
                  </div>
                </TableCell>
                <TableCell className="max-w-xs">
                  <div className="text-sm">
                    {formatSubmittedBy(company['vehicle-photos'] || [])}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Hash className="h-3 w-3 text-muted-foreground" />
                    <span className="text-sm">{formatCodes(company.sic_codes)}</span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Hash className="h-3 w-3 text-muted-foreground" />
                    <span className="text-sm">{formatCodes(company.naics_codes)}</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {company.zoominfo_id || '-'}
                </TableCell>
              </TableRow>
              
              {/* Expanded contact rows */}
              {expandedCompanies.has(company.id) && (
                <>
                  {/* Contact header row */}
                  <TableRow className="bg-muted/50 border-t">
                    <TableCell></TableCell>
                    <TableCell className="font-medium text-xs text-muted-foreground">Full Name</TableCell>
                    <TableCell className="font-medium text-xs text-muted-foreground">Job Title</TableCell>
                    <TableCell className="font-medium text-xs text-muted-foreground">Contact Info</TableCell>
                    <TableCell className="font-medium text-xs text-muted-foreground">Status</TableCell>
                    <TableCell className="font-medium text-xs text-muted-foreground">Email Subject</TableCell>
                    <TableCell className="font-medium text-xs text-muted-foreground">Email Body</TableCell>
                    <TableCell className="font-medium text-xs text-muted-foreground">Text Message</TableCell>
                    <TableCell className="font-medium text-xs text-muted-foreground">Actions</TableCell>
                    <TableCell className="font-medium text-xs text-muted-foreground">Created</TableCell>
                    <TableCell className="font-medium text-xs text-muted-foreground">Zoominfo ID</TableCell>
                    <TableCell></TableCell>
                    <TableCell></TableCell>
                    <TableCell></TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                  {sortContactsByStatus(company.contacts).map((contact) => (
                    <TableRow key={contact.id} className="bg-muted/30">
                      <TableCell></TableCell>
                      <TableCell className="pl-8">
                        <div className="text-sm text-muted-foreground">
                          {formatFullName(contact.first_name, contact.middle_name, contact.last_name)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-muted-foreground">
                          {contact.title || '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1 text-sm">
                          {contact.email && (
                            <div className="flex items-center gap-1">
                              <Mail className="h-3 w-3" />
                              {contact.email}
                            </div>
                          )}
                          {contact.phone && (
                            <div className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {contact.phone}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          contact.status === 'ready_to_send' 
                            ? 'bg-green-100 text-green-800' 
                            : contact.status === 'sent'
                            ? 'bg-purple-100 text-purple-800'
                            : contact.status === 'do_not_contact'
                            ? 'bg-red-100 text-red-800'
                            : contact.status === 'no_contact'
                            ? 'bg-gray-100 text-gray-800'
                            : contact.status === 'failed'
                            ? 'bg-red-100 text-red-800'
                            : contact.status === 'non-executive'
                            ? 'bg-orange-100 text-orange-800'
                            : contact.status === 'generating_message'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                          {contact.status === 'ready_to_send' ? 'Ready to Send' 
                            : contact.status === 'sent' ? 'Sent'
                            : contact.status === 'do_not_contact' ? 'Do Not Contact'
                            : contact.status === 'no_contact' ? 'No Contact'
                            : contact.status === 'failed' ? 'Failed'
                            : contact.status === 'non-executive' ? 'Non-Executive'
                            : contact.status === 'generating_message' ? 'Generating Message'
                            : 'Generating Message'}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="text-sm text-muted-foreground">
                          {contact.email_subject || '-'}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="text-sm text-muted-foreground max-h-20 overflow-y-auto">
                          {contact.email_body || '-'}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="text-sm text-muted-foreground max-h-20 overflow-y-auto">
                          {contact.text_message || '-'}
                        </div>
                      </TableCell>
                      <TableCell>
                        {contact.status === 'ready_to_send' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              console.log('Button clicked! Contact ID:', contact.id, 'Status:', contact.status)
                              updateContactStatus(contact.id, 'sent')
                            }}
                            className="h-7 px-2"
                          >
                            <Send className="h-3 w-3 mr-1" />
                            Mark as Sent
                          </Button>
                        )}
                        {contact.status !== 'ready_to_send' && (
                          <div className="text-xs text-muted-foreground">
                            Status: {contact.status}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDate(contact.created_at)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {contact.zoominfo_id || '-'}
                      </TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  ))}
                </>
              )}
            </React.Fragment>
          ))
          )}
        </TableBody>
        </Table>
        
        {!isLoading && paginatedData.data.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No companies found
          </div>
        )}
      </div>

      {/* Pagination */}
      {!isLoading && paginatedData.totalPages > 1 && (
        <Pagination
          currentPage={paginatedData.currentPage}
          totalPages={paginatedData.totalPages}
          onPageChange={handlePageChange}
        />
      )}
    </div>
  )
}
