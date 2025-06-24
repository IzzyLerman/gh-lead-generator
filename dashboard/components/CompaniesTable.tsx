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
import { ChevronRight, ChevronDown, Mail, Phone, MapPin, Building } from 'lucide-react'
import { CompanyWithContacts } from '@/lib/server-utils'
import { Tables } from '@/types/database'

interface CompaniesTableProps {
  initialData: CompanyWithContacts[]
}

export default function CompaniesTable({ initialData }: CompaniesTableProps) {
  const [companies, setCompanies] = useState<CompanyWithContacts[]>(initialData)
  const [expandedCompanies, setExpandedCompanies] = useState<Set<number>>(new Set())
  const supabase = createClient()

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
              contacts: []
            }, ...prev])
          } else if (payload.eventType === 'UPDATE') {
            const updatedCompany = payload.new as Tables<'companies'>
            setCompanies(prev => prev.map(company => 
              company.id === updatedCompany.id 
                ? { ...updatedCompany, contacts: company.contacts }
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
      .subscribe((status) => {
        console.log('Realtime subscription status:', status)
        if (status === 'SUBSCRIBED') {
          console.log('✅ Successfully subscribed to realtime changes')
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Realtime subscription error')
        } else if (status === 'TIMED_OUT') {
          console.error('❌ Realtime subscription timed out')
        } else if (status === 'CLOSED') {
          console.log('🔒 Realtime subscription closed')
        }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  const toggleExpand = (companyId: number) => {
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

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"></TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Industry</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Contact</TableHead>
            <TableHead>Status</TableHead>
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
  )
}