'use client'

import React, { useState, useEffect } from 'react'
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
import { ChevronRight, ChevronDown, Mail, Phone, MapPin, Building, Download } from 'lucide-react'
import { CompanyWithContactsAndPhotos } from '@/lib/server-utils'
import { VehiclePhotoGallery } from './VehiclePhotoGallery'
import { Tables } from '@/types/database'

interface CompaniesTableProps {
  initialData: CompanyWithContactsAndPhotos[]
}

export default function CompaniesTable({ initialData }: CompaniesTableProps) {
  const [companies, setCompanies] = useState<CompanyWithContactsAndPhotos[]>(initialData)
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set())
  const [isExporting, setIsExporting] = useState<string | null>(null)
  const supabase = createClient()

  // Debug logging
  console.log('CompaniesTable component mounted')
  console.log('Initial data length:', initialData.length)

  useEffect(() => {
    console.log('Setting up realtime subscription...')
    const channel = supabase
      .channel('dashboard-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'companies' },
        (payload) => {
          console.log('🏢 Company change detected:', payload)
          
          if (payload.eventType === 'INSERT') {
            const newCompany = payload.new as Tables<'companies'>
            setCompanies(prev => [{
              ...newCompany,
              contacts: [],
              'vehicle-photos': []
            }, ...prev])
          } else if (payload.eventType === 'UPDATE') {
            const updatedCompany = payload.new as Tables<'companies'>
            setCompanies(prev => prev.map(company => 
              company.id === updatedCompany.id 
                ? { ...updatedCompany, contacts: company.contacts, 'vehicle-photos': company['vehicle-photos'] }
                : company
            ))
          } else if (payload.eventType === 'DELETE') {
            const deletedId = payload.old.id
            setCompanies(prev => prev.filter(company => company.id !== deletedId))
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'contacts' },
        (payload) => {
          console.log('Contact change detected:', payload)
          
          if (payload.eventType === 'INSERT') {
            const newContact = payload.new as Tables<'contacts'>
            setCompanies(prev => prev.map(company => 
              company.id.toString() === newContact.company_id
                ? { ...company, contacts: [...company.contacts, newContact] }
                : company
            ))
          } else if (payload.eventType === 'UPDATE') {
            const updatedContact = payload.new as Tables<'contacts'>
            setCompanies(prev => prev.map(company => 
              company.id.toString() === updatedContact.company_id
                ? { 
                    ...company, 
                    contacts: company.contacts.map(contact => 
                      contact.id === updatedContact.id ? updatedContact : contact
                    )
                  }
                : company
            ))
          } else if (payload.eventType === 'DELETE') {
            const deletedContact = payload.old as Tables<'contacts'>
            setCompanies(prev => prev.map(company => 
              company.id.toString() === deletedContact.company_id
                ? { 
                    ...company, 
                    contacts: company.contacts.filter(contact => contact.id !== deletedContact.id)
                  }
                : company
            ))
          }
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'vehicle-photos' },
        (payload) => {
          console.log('Vehicle photo change detected:', payload)
          
          if (payload.eventType === 'INSERT') {
            const newPhoto = payload.new as Tables<'vehicle-photos'>
            setCompanies(prev => prev.map(company => 
              company.id === newPhoto.company_id
                ? { ...company, 'vehicle-photos': [...company['vehicle-photos'], newPhoto] }
                : company
            ))
          } else if (payload.eventType === 'UPDATE') {
            const updatedPhoto = payload.new as Tables<'vehicle-photos'>
            setCompanies(prev => prev.map(company => 
              company.id === updatedPhoto.company_id
                ? { 
                    ...company, 
                    'vehicle-photos': company['vehicle-photos'].map(photo => 
                      photo.id === updatedPhoto.id ? updatedPhoto : photo
                    )
                  }
                : company
            ))
          } else if (payload.eventType === 'DELETE') {
            const deletedPhoto = payload.old as Tables<'vehicle-photos'>
            setCompanies(prev => prev.map(company => 
              company.id === deletedPhoto.company_id
                ? { 
                    ...company, 
                    'vehicle-photos': company['vehicle-photos'].filter(photo => photo.id !== deletedPhoto.id)
                  }
                : company
            ))
          }
        }
      )
      .subscribe((status) => {
        console.log('Realtime subscription status:', status)
        if (status === 'SUBSCRIBED') {
          console.log('✅ Successfully subscribed to realtime changes')
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Realtime subscription error')
        } else if (status === 'TIMED_OUT') {
          console.error('⏰ Realtime subscription timed out')
        } else if (status === 'CLOSED') {
          console.log('🔒 Realtime subscription closed')
        }
      })

    return () => {
      console.log('Cleaning up realtime subscription')
      supabase.removeChannel(channel)
    }
  }, [supabase])

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
        console.error('Supabase error object:', JSON.stringify(error, null, 2))
        throw error
      }
      
      if (!data) {
        throw new Error('No data returned from export function')
      }
      
      const timestamp = new Date().toISOString().split('T')[0]
      downloadCSV(data, `companies-${timestamp}.csv`)
    } catch (error) {
      console.error('Error exporting companies:')
      console.error('Error message:', (error as Error)?.message)
      console.error('Error stack:', (error as Error)?.stack)
      console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)))
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
        console.error('Supabase error object:', JSON.stringify(error, null, 2))
        throw error
      }
      
      if (!data) {
        throw new Error('No data returned from export function')
      }
      
      const timestamp = new Date().toISOString().split('T')[0]
      downloadCSV(data, `contacts-${timestamp}.csv`)
    } catch (error) {
      console.error('Error exporting contacts:')
      console.error('Error message:', (error as Error)?.message)
      console.error('Error stack:', (error as Error)?.stack)
      console.error('Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error)))
      alert(`Failed to export contacts: ${(error as Error)?.message || 'Unknown error'}`)
    } finally {
      setIsExporting(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Export buttons */}
      <div className="flex gap-2 px-6 pt-4">
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

      <div className="rounded-md border">
        <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"></TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Industry</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Photos</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Messages</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.map((company) => (
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
                  <div className="flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-muted-foreground" />
                    {company.city && company.state 
                      ? `${company.city}, ${company.state}`
                      : company.city || company.state || '-'
                    }
                  </div>
                </TableCell>
                <TableCell>
                  <div className="space-y-1 text-sm">
                    {company.primary_email && (
                      <div className="flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {company.primary_email}
                      </div>
                    )}
                    {company.primary_phone && (
                      <div className="flex items-center gap-1">
                        <Phone className="h-3 w-3" />
                        {company.primary_phone}
                      </div>
                    )}
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
                      : company.status === 'completed'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-gray-100 text-gray-800'
                  }`}>
                    {company.status || 'unknown'}
                  </span>
                </TableCell>
                <TableCell className="max-w-xs">
                  <div className="space-y-1 text-sm">
                    {company.email_message && (
                      <div className="truncate text-muted-foreground" title={company.email_message}>
                        <span className="font-medium">Email:</span> {company.email_message}
                      </div>
                    )}
                    {company.text_message && (
                      <div className="truncate text-muted-foreground" title={company.text_message}>
                        <span className="font-medium">Text:</span> {company.text_message}
                      </div>
                    )}
                    {!company.email_message && !company.text_message && (
                      <div className="text-muted-foreground">-</div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(company.created_at)}
                </TableCell>
              </TableRow>
              
              {/* Expanded contact rows */}
              {expandedCompanies.has(company.id) && company.contacts.map((contact) => (
                <TableRow key={contact.id} className="bg-muted/30">
                  <TableCell></TableCell>
                  <TableCell className="pl-8">
                    <div className="text-sm text-muted-foreground">
                      {contact.name || 'Unnamed Contact'}
                      {contact.title && <span className="ml-2">({contact.title})</span>}
                    </div>
                  </TableCell>
                  <TableCell></TableCell>
                  <TableCell></TableCell>
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
                  <TableCell></TableCell>
                  <TableCell></TableCell>
                  <TableCell></TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(contact.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </React.Fragment>
          ))}
        </TableBody>
        </Table>
        
        {companies.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No companies found
          </div>
        )}
      </div>
    </div>
  )
}
