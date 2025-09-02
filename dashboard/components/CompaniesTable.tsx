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
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { ChevronRight, ChevronDown, Mail, Phone, MapPin, Building, Download, HelpCircle, Globe, Hash, Send, ArrowLeft, ArrowRight, Edit, Loader2, Filter } from 'lucide-react'
import { CompanyWithContactsAndPhotos, PaginatedResult } from '@/lib/server-utils'
import { fetchCompaniesWithContactsAndPhotos, FilterState } from '@/lib/client-utils'
import { VehiclePhotoGallery } from './VehiclePhotoGallery'
import { Tables } from '@/types/database'
import { Pagination } from '@/components/ui/pagination'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { StatusDropdown } from '@/components/ui/status-dropdown'
import { FilterModal } from '@/components/FilterModal'
import { createLogger } from '@/utils/logger'

const PAGE_SIZE = 6

interface TruncatedTextProps {
  text: string | string[] | null
  maxLength: number
  className?: string
}

function TruncatedText({ text, maxLength, className = "" }: TruncatedTextProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  
  if (!text) return <span className={className}>-</span>
  
  const textString = Array.isArray(text) ? text.join(', ') : text
  const shouldTruncate = textString.length > maxLength
  const displayText = shouldTruncate && !isExpanded 
    ? textString.slice(0, maxLength) + '...' 
    : textString
    
  return (
    <span className={className}>
      {displayText}
      {shouldTruncate && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="ml-1 text-blue-600 hover:text-blue-800 text-sm"
        >
          {isExpanded ? 'less' : 'more'}
        </button>
      )}
    </span>
  )
}

function truncateText(text: string | null, maxLength: number): string {
  if (!text) return '-'
  return text.length > maxLength ? text.slice(0, maxLength) + '...' : text
}

interface MessageModalProps {
  contact: Tables<'contacts'> | null
  company: CompanyWithContactsAndPhotos | null
  isOpen: boolean
  onClose: () => void
  onMarkAsSent: (contactId: string) => void
  onUpdateContact: (contactId: string, updates: Partial<Pick<Tables<'contacts'>, 'email' | 'email_subject' | 'email_body' | 'text_message' | 'verifalia_email_valid'>>) => void
  onSendEmail: (contactId: string) => Promise<void>
}

function MessageModal({ contact, company, isOpen, onClose, onMarkAsSent, onUpdateContact, onSendEmail }: MessageModalProps) {
  const [editingEmail, setEditingEmail] = useState(false)
  const [editingEmailSubject, setEditingEmailSubject] = useState(false)
  const [editingEmailMessage, setEditingEmailMessage] = useState(false)
  const [editingTextMessage, setEditingTextMessage] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [showVerificationError, setShowVerificationError] = useState(false)
  const [verificationErrorDetails, setVerificationErrorDetails] = useState<{
    status: string;
    message: string;
    canSkip: boolean;
  } | null>(null)
  
  const [emailValue, setEmailValue] = useState('')
  const [emailSubjectValue, setEmailSubjectValue] = useState('')
  const [emailMessageValue, setEmailMessageValue] = useState('')
  const [textMessageValue, setTextMessageValue] = useState('')

  useEffect(() => {
    if (contact) {
      setEmailValue(contact.email || '')
      setEmailSubjectValue(contact.email_subject || '')
      setEmailMessageValue(contact.email_body || '')
      setTextMessageValue(contact.text_message || '')
    }
  }, [contact])

  useEffect(() => {
    if (!isOpen) {
      setIsSending(false)
      setShowConfirmation(false)
      setShowVerificationError(false)
      setVerificationErrorDetails(null)
    }
  }, [isOpen])

  if (!contact || !company) return null

  const hasEmail = contact.email_subject || contact.email_body
  const hasTextMessage = contact.text_message

  const formatFullName = (firstName: string | null, middleName: string | null, lastName: string | null) => {
    const nameParts = [firstName, middleName, lastName].filter(part => part && part.trim())
    return nameParts.length > 0 ? nameParts.join(' ') : 'Unnamed Contact'
  }

  const handleUpdateEmail = () => {
    onUpdateContact(contact.id, { email: emailValue })
    setEditingEmail(false)
  }

  const handleCancelEmail = () => {
    setEmailValue(contact.email || '')
    setEditingEmail(false)
  }

  const handleUpdateEmailSubject = () => {
    onUpdateContact(contact.id, { email_subject: emailSubjectValue })
    setEditingEmailSubject(false)
  }

  const handleCancelEmailSubject = () => {
    setEmailSubjectValue(contact.email_subject || '')
    setEditingEmailSubject(false)
  }

  const handleUpdateEmailMessage = () => {
    onUpdateContact(contact.id, { email_body: emailMessageValue })
    setEditingEmailMessage(false)
  }

  const handleCancelEmailMessage = () => {
    setEmailMessageValue(contact.email_body || '')
    setEditingEmailMessage(false)
  }

  const handleUpdateTextMessage = () => {
    onUpdateContact(contact.id, { text_message: textMessageValue })
    setEditingTextMessage(false)
  }

  const handleCancelTextMessage = () => {
    setTextMessageValue(contact.text_message || '')
    setEditingTextMessage(false)
  }

  const handleSendEmailInternal = async (skipVerification = false) => {
    try {
      console.log('Sending email for contact:', contact.id, 'skipVerification:', skipVerification)
      
      const sendEmailUrl = process.env.NEXT_PUBLIC_SEND_EMAIL_URL
      
      if (!sendEmailUrl) {
        throw new Error('Send email URL not configured')
      }
      
      const requestBody: { contact_id: string; skip_verification?: boolean } = {
        contact_id: contact.id
      }
      
      if (skipVerification) {
        requestBody.skip_verification = true
      }
      
      const response = await fetch(sendEmailUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(requestBody)
      })
      
      if (response.ok) {
        console.log('Email sent successfully')
        await onSendEmail(contact.id)
        onClose()
      } else if (response.status === 401) {
        let errorData
        try {
          const responseText = await response.text()
          errorData = JSON.parse(responseText)
        } catch (parseError) {
          console.error('Failed to parse verification error:', parseError)
          setVerificationErrorDetails({
            status: 'Parse Error',
            message: `Email verification failed: Response parsing error`,
            canSkip: false
          })
          setShowVerificationError(true)
          return
        }
        
        const verificationStatus = errorData.verification_status || 'Unknown verification status'
        const canSkipVerification = errorData.can_skip_verification === true
        
        console.error('Email verification failed:', errorData)
        
        setVerificationErrorDetails({
          status: verificationStatus,
          message: errorData.message || 'Email verification failed',
          canSkip: canSkipVerification
        })
        setShowVerificationError(true)
      } else {
        const errorText = await response.text()
        console.error('Failed to send email:', errorText)
        
        setVerificationErrorDetails({
          status: 'Send Error',
          message: `Failed to send email: ${errorText}`,
          canSkip: false
        })
        setShowVerificationError(true)
      }
    } catch (error) {
      console.error('Error sending email:', error)
      
      setVerificationErrorDetails({
        status: 'Network Error',
        message: `Failed to send email: ${(error as Error)?.message || 'Unknown error'}`,
        canSkip: false
      })
      setShowVerificationError(true)
    } finally {
      setIsSending(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Message Details</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Contact Information */}
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">
              {formatFullName(contact.first_name, contact.middle_name, contact.last_name)}
            </h3>
            <p className="text-sm text-muted-foreground">{contact.title || 'No title available'}</p>
            <p className="text-sm font-medium">{company.name}</p>
          </div>

          {/* Contact Info */}
          <div className="space-y-2">
            <h4 className="font-medium">Contact Information</h4>
            <div className="space-y-3 text-sm">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1">
                    <Mail className="h-3 w-3" />
                    <span className="text-sm font-medium">Email:</span>
                  </div>
                  {!editingEmail && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditingEmail(true)}
                    >
                      <Edit className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                  )}
                </div>
                {editingEmail ? (
                  <div className="space-y-2">
                    <Textarea
                      value={emailValue}
                      onChange={(e) => setEmailValue(e.target.value)}
                      className="text-sm"
                      rows={1}
                      placeholder="Enter email address"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleUpdateEmail}
                      >
                        Update
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCancelEmail}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm bg-muted/30 p-2 rounded border">
                    {contact.email || 'No email'}
                  </div>
                )}
              </div>
              {contact.phone && (
                <div className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  <span className="text-sm font-medium">Phone:</span>
                  <span>{contact.phone}</span>
                </div>
              )}
            </div>
          </div>

          {/* Message Content */}
          {hasEmail && (
            <div className="space-y-3">
              <h4 className="font-medium">Email Message</h4>
              {(contact.email_subject || editingEmailSubject) && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium">Subject:</p>
                    {!editingEmailSubject && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingEmailSubject(true)}
                      >
                        <Edit className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                    )}
                  </div>
                  {editingEmailSubject ? (
                    <div className="space-y-2">
                      <Textarea
                        value={emailSubjectValue}
                        onChange={(e) => setEmailSubjectValue(e.target.value)}
                        className="text-sm"
                        rows={2}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleUpdateEmailSubject}
                        >
                          Update
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCancelEmailSubject}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm bg-muted/30 p-2 rounded border">{contact.email_subject || 'No subject'}</p>
                  )}
                </div>
              )}
              {(contact.email_body || editingEmailMessage) && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-sm font-medium">Message:</p>
                    {!editingEmailMessage && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingEmailMessage(true)}
                      >
                        <Edit className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                    )}
                  </div>
                  {editingEmailMessage ? (
                    <div className="space-y-2">
                      <Textarea
                        value={emailMessageValue}
                        onChange={(e) => setEmailMessageValue(e.target.value)}
                        className="text-sm"
                        rows={6}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleUpdateEmailMessage}
                        >
                          Update
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCancelEmailMessage}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm bg-muted/30 p-3 rounded border whitespace-pre-wrap">
                      {contact.email_body || 'No message'}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {(hasTextMessage || editingTextMessage) && !hasEmail && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-medium">Text Message</h4>
                {!editingTextMessage && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditingTextMessage(true)}
                  >
                    <Edit className="h-3 w-3 mr-1" />
                    Edit
                  </Button>
                )}
              </div>
              {editingTextMessage ? (
                <div className="space-y-2">
                  <Textarea
                    value={textMessageValue}
                    onChange={(e) => setTextMessageValue(e.target.value)}
                    className="text-sm"
                    rows={4}
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleUpdateTextMessage}
                    >
                      Update
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCancelTextMessage}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-sm bg-muted/30 p-3 rounded border whitespace-pre-wrap">
                  {contact.text_message || 'No message'}
                </div>
              )}
            </div>
          )}

          {!hasEmail && !hasTextMessage && (
            <div className="text-center py-4 text-muted-foreground">
              No message content available
            </div>
          )}

          {/* Actions */}
          {contact.status === 'ready_to_send' && (
            <div className="flex justify-end pt-4 border-t">
              {hasEmail ? (
                <>
                  <Button
                    onClick={() => setShowConfirmation(true)}
                    disabled={isSending}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {isSending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="h-4 w-4 mr-2" />
                        Send Email
                      </>
                    )}
                  </Button>
                  
                  {/* Email Confirmation Dialog */}
                  {showConfirmation && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                      <div className="bg-white dark:bg-card p-6 rounded-lg max-w-sm w-full mx-4">
                        <h3 className="text-lg font-semibold mb-2">Confirm Email Send</h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          Send email to {contact.email}?
                        </p>
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="outline"
                            onClick={() => setShowConfirmation(false)}
                            size="sm"
                            disabled={isSending}
                          >
                            Cancel
                          </Button>
                          <Button
                            onClick={async () => {
                              setShowConfirmation(false)
                              setIsSending(true)
                              await handleSendEmailInternal(false)
                            }}
                            className="bg-blue-600 hover:bg-blue-700"
                            size="sm"
                            disabled={isSending}
                          >
                            {isSending ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Sending...
                              </>
                            ) : (
                              'Send'
                            )}
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Verification Error Dialog */}
                  {showVerificationError && verificationErrorDetails && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                      <div className="bg-white dark:bg-card p-6 rounded-lg max-w-md w-full mx-4">
                        <h3 className="text-lg font-semibold mb-2">Email Verification Failed</h3>
                        <p className="text-sm text-muted-foreground mb-2">
                          <strong>Status:</strong> {verificationErrorDetails.status}
                        </p>
                        <p className="text-sm text-muted-foreground mb-4">
                          {verificationErrorDetails.message}
                        </p>
                        <p className="text-sm text-muted-foreground mb-4">
                          The email address may be invalid, expired, or undeliverable. You can still send the email if you believe the address is correct.
                        </p>
                        <div className="flex gap-2 justify-end">
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowVerificationError(false)
                              setVerificationErrorDetails(null)
                              setIsSending(false)
                            }}
                            size="sm"
                            disabled={isSending}
                          >
                            Cancel
                          </Button>
                          {verificationErrorDetails.canSkip && (
                            <Button
                              onClick={async () => {
                                setShowVerificationError(false)
                                setVerificationErrorDetails(null)
                                setIsSending(true)
                                await handleSendEmailInternal(true)
                              }}
                              className="bg-orange-600 hover:bg-orange-700"
                              size="sm"
                              disabled={isSending}
                            >
                              {isSending ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Sending...
                                </>
                              ) : (
                                'Send Anyway'
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <Button
                  onClick={() => onMarkAsSent(contact.id)}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Send className="h-4 w-4 mr-2" />
                  Mark as Sent
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface CompaniesTableProps {
  initialData?: PaginatedResult<CompanyWithContactsAndPhotos>
}

export default function CompaniesTable({ initialData }: CompaniesTableProps) {
  const [paginatedData, setPaginatedData] = useState<PaginatedResult<CompanyWithContactsAndPhotos>>(
    initialData || { data: [], totalCount: 0, totalPages: 0, currentPage: 1, pageSize: PAGE_SIZE }
  )
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set())
  const [isExporting, setIsExporting] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedContact, setSelectedContact] = useState<Tables<'contacts'> | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<CompanyWithContactsAndPhotos | null>(null)
  const [isMessageModalOpen, setIsMessageModalOpen] = useState(false)
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false)
  const [isExportModalOpen, setIsExportModalOpen] = useState(false)
  const [exportContactsType, setExportContactsType] = useState<'active' | 'sent'>('active')
  const [currentFilters, setCurrentFilters] = useState<FilterState>({ criteria: [] })
  const [editingPrimaryIndustry, setEditingPrimaryIndustry] = useState<string | null>(null)
  const [primaryIndustryValue, setPrimaryIndustryValue] = useState('')
  const [isCustomIndustry, setIsCustomIndustry] = useState(false)
  const tableRef = React.useRef<HTMLDivElement>(null)
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
      const result = await fetchCompaniesWithContactsAndPhotos({ 
        page, 
        pageSize: PAGE_SIZE, 
        filters: currentFilters 
      })
      setPaginatedData(result)
      setExpandedCompanies(new Set()) // Clear expanded state when changing pages
    } catch (error) {
      logger.logError(error as Error, 'Error fetching page data', { page, pageSize: PAGE_SIZE })
    } finally {
      setIsLoading(false)
    }
  }, [logger, currentFilters])

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
            if (paginatedData.currentPage === 1) {
              handlePageChange(1)
            }
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
  }, [handlePageChange, logger, supabase, paginatedData.currentPage])

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


  const sortContactsByStatus = (contacts: Tables<'contacts'>[]) => {
    const statusOrder = {
      'active': 1,
      'ready_to_send': 2,
      'sent': 3,
      'do_not_contact': 4,
      'no_contact': 5,
      'failed': 6,
      'non-executive': 7,
      'generating_message': 8
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

  const handleExportActiveContacts = async () => {
    setIsExporting('active-contacts')
    try {
      const { data, error } = await supabase.schema('private').rpc('export_active_contacts_csv')
      
      if (error) {
        logger.logError(error, 'Supabase error during active contacts export')
        throw error
      }
      
      if (!data) {
        throw new Error('No data returned from export function')
      }
      
      const timestamp = new Date().toISOString().split('T')[0]
      downloadCSV(data, `active-contacts-${timestamp}.csv`)
    } catch (error) {
      logger.logError(error as Error, 'Error exporting active contacts')
      alert(`Failed to export active contacts: ${(error as Error)?.message || 'Unknown error'}`)
    } finally {
      setIsExporting(null)
    }
  }

  const handleExportSentContacts = async () => {
    setIsExporting('sent-contacts')
    try {
      const { data, error } = await supabase.schema('private').rpc('export_sent_contacts_csv')
      
      if (error) {
        logger.logError(error, 'Supabase error during sent contacts export')
        throw error
      }
      
      if (!data) {
        throw new Error('No data returned from export function')
      }
      
      const timestamp = new Date().toISOString().split('T')[0]
      downloadCSV(data, `sent-contacts-${timestamp}.csv`)
    } catch (error) {
      logger.logError(error as Error, 'Error exporting sent contacts')
      alert(`Failed to export sent contacts: ${(error as Error)?.message || 'Unknown error'}`)
    } finally {
      setIsExporting(null)
    }
  }

  const handleExportContactsWithModal = async () => {
    if (exportContactsType === 'active') {
      await handleExportActiveContacts()
    } else {
      await handleExportSentContacts()
    }
    setIsExportModalOpen(false)
  }

  const updateContactStatus = async (contactId: string, newStatus: string) => {
    try {
      console.log('Update contact status - contactId:', contactId, 'newStatus:', newStatus)
      
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
        throw error
      } else if (data && data.length === 0) {
        console.error('No rows updated - possible RLS/permission issue')
        const errorMsg = `No rows updated - contact ${contactId} may not be updateable due to permissions`
        alert(errorMsg)
        throw new Error(errorMsg)
      } else {
        console.log('Update successful:', data)
        
        // If marking contact as sent, also update company status to sent
        if (newStatus === 'sent' && existingContact) {
          const { error: companyUpdateError } = await supabase
            .from('companies')
            .update({ status: 'sent' })
            .eq('id', existingContact.company_id)
          
          if (companyUpdateError) {
            console.error('Error updating company status:', companyUpdateError)
            logger.logError(companyUpdateError, 'Error updating company status to sent', { companyId: existingContact.company_id })
          } else {
            console.log('Successfully updated company status to sent')
          }
        }
      }
    } catch (error) {
      console.error('Caught error:', error)
      logger.logError(error as Error, 'Error updating contact status', { contactId, newStatus })
      if (!(error as Error)?.message?.includes('Failed to update contact status')) {
        alert(`Failed to update contact status: ${(error as Error)?.message || 'Unknown error'}`)
      }
      throw error
    }
  }

  const updateCompanyStatus = async (companyId: string, newStatus: string) => {
    try {
      console.log('Update company status - companyId:', companyId, 'newStatus:', newStatus)
      
      const { error, data } = await supabase
        .from('companies')
        .update({ status: newStatus })
        .eq('id', companyId)
        .select()
      
      console.log('Supabase company update result:', { error, data, dataLength: data?.length })
      
      if (error) {
        console.error('Supabase error:', error)
        logger.logError(error, 'Error updating company status', { companyId, newStatus })
        alert(`Failed to update company status: ${error.message}`)
        throw error
      } else if (data && data.length === 0) {
        console.error('No rows updated - possible RLS/permission issue')
        const errorMsg = `No rows updated - company ${companyId} may not be updateable due to permissions`
        alert(errorMsg)
        throw new Error(errorMsg)
      } else {
        console.log('Company update successful:', data)
      }
    } catch (error) {
      console.error('Caught error:', error)
      logger.logError(error as Error, 'Error updating company status', { companyId, newStatus })
      if (!(error as Error)?.message?.includes('Failed to update company status')) {
        alert(`Failed to update company status: ${(error as Error)?.message || 'Unknown error'}`)
      }
      throw error
    }
  }

  const scrollLeft = () => {
    if (tableRef.current) {
      tableRef.current.scrollBy({ left: -300, behavior: 'smooth' })
    }
  }

  const scrollRight = () => {
    if (tableRef.current) {
      tableRef.current.scrollBy({ left: 300, behavior: 'smooth' })
    }
  }

  const openMessageModal = (contact: Tables<'contacts'>, company: CompanyWithContactsAndPhotos) => {
    setSelectedContact(contact)
    setSelectedCompany(company)
    setIsMessageModalOpen(true)
  }

  const closeMessageModal = () => {
    setIsMessageModalOpen(false)
    setSelectedContact(null)
    setSelectedCompany(null)
  }

  const handleMarkAsSent = (contactId: string) => {
    updateContactStatus(contactId, 'sent')
    closeMessageModal()
  }

  const handleSendEmail = async (contactId: string) => {
    await updateContactStatus(contactId, 'sent')
  }

  const handleApplyFilters = async (filters: FilterState) => {
    setCurrentFilters(filters)
    setIsLoading(true)
    try {
      const result = await fetchCompaniesWithContactsAndPhotos({ 
        page: 1, 
        pageSize: PAGE_SIZE, 
        filters 
      })
      setPaginatedData(result)
      setExpandedCompanies(new Set())
    } catch (error) {
      logger.logError(error as Error, 'Error applying filters', { filters })
    } finally {
      setIsLoading(false)
    }
  }

  const companyStatusOptions = [
    { value: 'processed', label: 'Processed', className: 'bg-green-100 text-green-800' },
    { value: 'not_found', label: 'Company Not Found', className: 'bg-red-100 text-red-800' },
    { value: 'low_revenue', label: 'Low Revenue', className: 'bg-yellow-100 text-yellow-800' },
    { value: 'no_execs', label: 'No Execs Found', className: 'bg-amber-100 text-amber-800' },
    { value: 'contacts_failed', label: 'No Contacts Found', className: 'bg-orange-100 text-orange-800' },
    { value: 'sent', label: 'Sent', className: 'bg-purple-100 text-purple-800' },
    { value: 'enriching', label: 'Enriching', className: 'bg-sky-100 text-sky-800' }
  ]

  const contactStatusOptions = [
    { value: 'active', label: 'Active Lead', className: 'bg-indigo-100 text-indigo-800' },
    { value: 'ready_to_send', label: 'Ready to Send', className: 'bg-green-100 text-green-800' },
    { value: 'sent', label: 'Sent', className: 'bg-purple-100 text-purple-800' },
    { value: 'do_not_contact', label: 'Do Not Contact', className: 'bg-red-100 text-red-800' },
    { value: 'no_contact', label: 'No Contact Info', className: 'bg-orange-100 text-orange-800' },
    { value: 'failed', label: 'Failed', className: 'bg-red-100 text-red-800' },
    { value: 'non-executive', label: 'Non-Executive', className: 'bg-amber-100 text-amber-800' },
    { value: 'generating_message', label: 'Generating Message', className: 'bg-sky-100 text-sky-800' }
  ]

  const industryOptions = [
    'plumbing',
    'HVAC',
    'roofing and siding',
    'landscaping',
    'electrical contracting'
  ]

  const startEditingPrimaryIndustry = (companyId: string, currentIndustry: string | null) => {
    setEditingPrimaryIndustry(companyId)
    setPrimaryIndustryValue(currentIndustry || '')
    
    // Check if current industry is one of the predefined options
    const isStandardIndustry = industryOptions.includes(currentIndustry || '')
    // If no current industry (null or empty), default to dropdown mode
    setIsCustomIndustry(Boolean(currentIndustry && !isStandardIndustry))
  }

  const cancelEditingPrimaryIndustry = () => {
    setEditingPrimaryIndustry(null)
    setPrimaryIndustryValue('')
    setIsCustomIndustry(false)
  }

  const savePrimaryIndustry = async (companyId: string) => {
    try {
      await updatePrimaryIndustry(companyId, primaryIndustryValue)
      cancelEditingPrimaryIndustry()
    } catch {
      // Error handling is done in updatePrimaryIndustry
    }
  }

  const handleIndustryDropdownChange = (value: string) => {
    if (value === 'other') {
      setIsCustomIndustry(true)
      setPrimaryIndustryValue('')
    } else {
      setIsCustomIndustry(false)
      setPrimaryIndustryValue(value)
    }
  }

  const updatePrimaryIndustry = async (companyId: string, newIndustry: string) => {
    try {
      console.log('Update primary industry - companyId:', companyId, 'newIndustry:', newIndustry)
      
      const { error, data } = await supabase
        .from('companies')
        .update({ primary_industry: newIndustry })
        .eq('id', companyId)
        .select()
      
      console.log('Supabase primary industry update result:', { error, data, dataLength: data?.length })
      
      if (error) {
        console.error('Supabase error:', error)
        logger.logError(error, 'Error updating primary industry', { companyId, newIndustry })
        alert(`Failed to update primary industry: ${error.message}`)
        throw error
      } else if (data && data.length === 0) {
        console.error('No rows updated - possible RLS/permission issue')
        const errorMsg = `No rows updated - company ${companyId} may not be updateable due to permissions`
        alert(errorMsg)
        throw new Error(errorMsg)
      } else {
        console.log('Primary industry update successful:', data)
      }
    } catch (error) {
      console.error('Caught error:', error)
      logger.logError(error as Error, 'Error updating primary industry', { companyId, newIndustry })
      if (!(error as Error)?.message?.includes('Failed to update primary industry')) {
        alert(`Failed to update primary industry: ${(error as Error)?.message || 'Unknown error'}`)
      }
      throw error
    }
  }

  const handleUpdateContact = async (contactId: string, updates: Partial<Pick<Tables<'contacts'>, 'email' | 'email_subject' | 'email_body' | 'text_message' | 'verifalia_email_valid'>>) => {
    try {
      console.log('Update contact - contactId:', contactId, 'updates:', updates)
      
      // If email is being updated, clear the verifalia_email_valid field
      const finalUpdates = updates.email !== undefined 
        ? { ...updates, verifalia_email_valid: null }
        : updates
      
      // Optimistically update the UI first
      setPaginatedData(prevData => ({
        ...prevData,
        data: prevData.data.map(company => ({
          ...company,
          contacts: company.contacts.map(contact =>
            contact.id === contactId ? { ...contact, ...finalUpdates } : contact
          )
        }))
      }))

      // Also update selectedContact if it matches
      if (selectedContact?.id === contactId) {
        setSelectedContact(prev => prev ? { ...prev, ...finalUpdates } : null)
      }
      
      const { error, data } = await supabase
        .from('contacts')
        .update(finalUpdates)
        .eq('id', contactId)
        .select()
      
      console.log('Supabase update result:', { error, data, dataLength: data?.length })
      
      if (error) {
        console.error('Supabase error:', error)
        logger.logError(error, 'Error updating contact message fields', { contactId, updates })
        alert(`Failed to update contact: ${error.message}`)
        // TODO: Revert optimistic update on error
      } else if (data && data.length === 0) {
        console.error('No rows updated - possible RLS/permission issue')
        alert(`No rows updated - contact ${contactId} may not be updateable due to permissions`)
        // TODO: Revert optimistic update on error
      } else {
        console.log('Update successful:', data)
      }
    } catch (error) {
      console.error('Caught error:', error)
      logger.logError(error as Error, 'Error updating contact message fields', { contactId, updates })
      alert(`Failed to update contact: ${(error as Error)?.message || 'Unknown error'}`)
      // TODO: Revert optimistic update on error
    }
  }

  return (
    <div className="space-y-4">
      {/* Export buttons and How to use */}
      <div className="flex justify-between items-center px-6 pt-4">
        <div className="flex gap-2">
          <Button
            onClick={() => setIsFilterModalOpen(true)}
            variant="outline"
            className={currentFilters.criteria.length > 0 ? 'ring-2 ring-blue-500' : ''}
          >
            <Filter className="h-4 w-4 mr-2" />
            Filter {currentFilters.criteria.length > 0 && `(${currentFilters.criteria.length})`}
          </Button>
          <Button
            onClick={handleExportCompanies}
            disabled={isExporting !== null}
            variant="outline"
          >
            <Download className="h-4 w-4 mr-2" />
            {isExporting === 'companies' ? 'Exporting...' : 'Companies'}
          </Button>
          <Dialog open={isExportModalOpen} onOpenChange={setIsExportModalOpen}>
            <DialogTrigger asChild>
              <Button
                disabled={isExporting !== null}
                variant="outline"
              >
                <Download className="h-4 w-4 mr-2" />
                Export Contacts
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Export Contacts</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="export-type" className="text-sm font-medium">
                    Select contact type to export:
                  </label>
                  <select
                    id="export-type"
                    value={exportContactsType}
                    onChange={(e) => setExportContactsType(e.target.value as 'active' | 'sent')}
                    className="w-full px-3 py-2 border border-input bg-background rounded-md text-sm"
                  >
                    <option value="active">Active Contacts</option>
                    <option value="sent">Sent Contacts</option>
                  </select>
                </div>
                <p className="text-sm text-muted-foreground">
                  {exportContactsType === 'active' 
                    ? 'Export contacts with status "active" in the special format for outreach.'
                    : 'Export contacts with status "sent" in the special format for tracking.'}
                </p>
              </div>
              <DialogFooter className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsExportModalOpen(false)}
                  disabled={isExporting !== null}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleExportContactsWithModal}
                  disabled={isExporting !== null}
                >
                  <Download className="h-4 w-4 mr-2" />
                  {isExporting === 'active-contacts' || isExporting === 'sent-contacts' ? 'Exporting...' : 'Export'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
              <DialogTitle>How to Use this Dashboard</DialogTitle>
            </DialogHeader>
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold mb-2">Submitting Pictures</h3>
                <p className="text-sm text-muted-foreground">
                  Email up to five images to <a href="mailto:vehicles@izzy.fish" className="text-blue-600 hover:text-blue-800 transition-colors duration-200 hover:underline">vehicles@izzy.fish</a> as attachments. Include the location if the option is presented.
                </p>
                <h3 className="font-semibold mb-2">Accepted File Types</h3>
                <p className="text-sm text-muted-foreground">
                    Any photos taken with iPhone should be accepted: .jpg, .png, .heic, .mp4, and .mov 
                </p>
	      </div>
	      <div>
                <h3 className="font-semibold mb-2">Outreach</h3>
		<p className="text-sm text-muted-foreground">
            Messages will be automatically generated for executives with valid contact information. Emails can be sent directly
            from the dashboard: hit &quot;view message&quot;, make any desired changes to the message content, and hit send. Text messages must be sent out manually.
		</p>
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

      {/* Table scroll navigation */}
      <div className="sticky top-0 bg-card z-10 border-b">
        <div className="flex justify-between items-center px-6 py-2">
          <Button
            variant="outline"
            size="sm"
            onClick={scrollLeft}
            className="h-8 w-8 p-0"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={scrollRight}
            className="h-8 w-8 p-0"
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <div ref={tableRef} className="overflow-x-auto relative" style={{ maxWidth: '100vw', height: '70vh' }}>
          <div style={{ minWidth: '2500px', width: '2500px' }}>
            <Table style={{ minWidth: '2500px', width: '2500px', position: 'relative', borderCollapse: 'separate', borderSpacing: '0' }}>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12"></TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Industry</TableHead>
            <TableHead>Website</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Photos</TableHead>
            <TableHead>Revenue</TableHead>
            <TableHead>Contact Info</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Date Created</TableHead>
            <TableHead>Zoominfo ID</TableHead>
            <TableHead>Submitted By</TableHead>
            <TableHead>SIC Codes</TableHead>
            <TableHead>NAICS Codes</TableHead>
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
              <TableRow className="cursor-pointer group">
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
                <TableCell>
                  {editingPrimaryIndustry === company.id ? (
                    <div className="flex items-center gap-2 min-w-[200px]">
                      {isCustomIndustry ? (
                        <Input
                          value={primaryIndustryValue}
                          onChange={(e) => setPrimaryIndustryValue(e.target.value)}
                          placeholder="Enter other industry"
                          className="text-sm h-8"
                          autoFocus
                        />
                      ) : (
                        <select
                          value={primaryIndustryValue}
                          onChange={(e) => handleIndustryDropdownChange(e.target.value)}
                          className="text-sm h-8 px-2 border rounded"
                          autoFocus
                        >
                          <option value="">Select industry...</option>
                          {industryOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                          <option value="other">Other...</option>
                        </select>
                      )}
                      <Button
                        size="sm"
                        onClick={() => savePrimaryIndustry(company.id)}
                        className="h-6 px-2 text-xs"
                        disabled={!primaryIndustryValue.trim()}
                      >
                        Save
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={cancelEditingPrimaryIndustry}
                        className="h-6 px-2 text-xs"
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div 
                      onClick={() => startEditingPrimaryIndustry(company.id, company.primary_industry)}
                      className="cursor-pointer hover:bg-muted/50 px-2 py-1 rounded text-sm min-h-[24px] flex items-center"
                      title="Click to edit industry"
                    >
                      {company.primary_industry ? (
                        <TruncatedText text={company.primary_industry} maxLength={25} />
                      ) : (
                        <span className="text-blue-600">click to set</span>
                      )}
                      <Edit className="h-3 w-3 ml-2 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  )}
                </TableCell>
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
                {/* Status */}
                <TableCell>
                  <StatusDropdown
                    currentStatus={company.status || 'enriching'}
                    statusOptions={companyStatusOptions}
                    onStatusChange={(newStatus) => updateCompanyStatus(company.id, newStatus)}
                  />
                </TableCell>
                {/* Photos */}
                <TableCell>
                  <VehiclePhotoGallery 
                    photos={company['vehicle-photos'] || []} 
                    companyName={company.name}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <span className="text-sm">{formatRevenue(company.revenue)}</span>
                  </div>
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

                <TableCell className="text-muted-foreground">
                  {formatDate(company.created_at)}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {company.zoominfo_id || '-'}
                </TableCell>
                <TableCell className="max-w-xs">
                  <div className="text-sm">
                    {formatSubmittedBy(company['vehicle-photos'] || [])}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Hash className="h-3 w-3 text-muted-foreground" />
                    <TruncatedText text={company.sic_codes} maxLength={15} className="text-sm" />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <Hash className="h-3 w-3 text-muted-foreground" />
                    <TruncatedText text={company.naics_codes} maxLength={15} className="text-sm" />
                  </div>
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
                    <TableCell className="font-medium text-xs text-muted-foreground">Actions</TableCell>
                    <TableCell className="font-medium text-xs text-muted-foreground">Email Subject</TableCell>
                    <TableCell className="font-medium text-xs text-muted-foreground">Email Body</TableCell>
                    <TableCell className="font-medium text-xs text-muted-foreground">Text Message</TableCell>
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
                        <StatusDropdown
                          currentStatus={contact.status || 'generating_message'}
                          statusOptions={contactStatusOptions}
                          onStatusChange={(newStatus) => updateContactStatus(contact.id, newStatus)}
                        />
                      </TableCell>
                      <TableCell>
                        {(contact.email_subject || contact.email_body || contact.text_message) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openMessageModal(contact, company)}
                            className="h-7 px-2"
                          >
                            <Mail className="h-3 w-3 mr-1" />
                            View Message
                          </Button>
                        ) : (
                          <div className="text-xs text-muted-foreground">
                            No message
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="text-sm text-muted-foreground">
                          {truncateText(contact.email_subject, 30)}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="text-sm text-muted-foreground">
                          {truncateText(contact.email_body, 50)}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-xs">
                        <div className="text-sm text-muted-foreground">
                          {truncateText(contact.text_message, 50)}
                        </div>
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
          </div>
          
          {!isLoading && paginatedData.data.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No companies found
            </div>
          )}
        </div>
      </div>

      {/* Pagination */}
      {!isLoading && paginatedData.totalPages > 1 && (
        <Pagination
          currentPage={paginatedData.currentPage}
          totalPages={paginatedData.totalPages}
          onPageChange={handlePageChange}
        />
      )}
      
      {/* Message Modal */}
      <MessageModal
        contact={selectedContact}
        company={selectedCompany}
        isOpen={isMessageModalOpen}
        onClose={closeMessageModal}
        onMarkAsSent={handleMarkAsSent}
        onUpdateContact={handleUpdateContact}
        onSendEmail={handleSendEmail}
      />
      
      <FilterModal
        isOpen={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        onApplyFilters={handleApplyFilters}
        statusOptions={companyStatusOptions}
        industryOptions={industryOptions}
        currentFilters={currentFilters}
      />
    </div>
  )
}
