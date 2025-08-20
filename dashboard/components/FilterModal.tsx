'use client'

import React, { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ChevronDown, X } from 'lucide-react'

export interface FilterCriteria {
  field: string
  values: string[]
}

export interface FilterState {
  criteria: FilterCriteria[]
}

interface StatusOption {
  value: string
  label: string
  className: string
}

interface FilterModalProps {
  isOpen: boolean
  onClose: () => void
  onApplyFilters: (filters: FilterState) => void
  statusOptions: StatusOption[]
  currentFilters: FilterState
}

export function FilterModal({ isOpen, onClose, onApplyFilters, statusOptions, currentFilters }: FilterModalProps) {
  const [selectedField, setSelectedField] = useState<string>('status')
  const [selectedValues, setSelectedValues] = useState<string[]>([])
  const [filters, setFilters] = useState<FilterState>(currentFilters)
  const [isFieldDropdownOpen, setIsFieldDropdownOpen] = useState(false)
  const [isValueDropdownOpen, setIsValueDropdownOpen] = useState(false)

  const fieldOptions = [
    { value: 'status', label: 'Status' }
  ]

  useEffect(() => {
    setFilters(currentFilters)
  }, [currentFilters])

  useEffect(() => {
    if (isOpen) {
      const statusFilter = filters.criteria.find(c => c.field === 'status')
      if (statusFilter) {
        setSelectedValues(statusFilter.values)
      } else {
        setSelectedValues([])
      }
      setSelectedField('status')
    }
  }, [isOpen, filters])

  const getAvailableValues = () => {
    if (selectedField === 'status') {
      return statusOptions
    }
    return []
  }

  const handleValueSelect = (value: string) => {
    setSelectedValues(prev => {
      if (prev.includes(value)) {
        return prev.filter(v => v !== value)
      } else {
        return [...prev, value]
      }
    })
  }



  const handleApply = () => {
    const finalFilters = { criteria: [] as FilterCriteria[] }
    
    if (selectedValues.length > 0) {
      finalFilters.criteria.push({ field: selectedField, values: [...selectedValues] })
    }
    
    setFilters(finalFilters)
    onApplyFilters(finalFilters)
    onClose()
  }

  const handleClear = () => {
    const emptyFilters = { criteria: [] }
    setFilters(emptyFilters)
    setSelectedValues([])
    onApplyFilters(emptyFilters)
    onClose()
  }

  const handleRemoveFilter = (field: string) => {
    setFilters(prev => ({
      criteria: prev.criteria.filter(c => c.field !== field)
    }))
  }

  const getValueLabel = (field: string, value: string) => {
    if (field === 'status') {
      const option = statusOptions.find(opt => opt.value === value)
      return option?.label || value
    }
    return value
  }

  const selectedFieldOption = fieldOptions.find(opt => opt.value === selectedField)
  const availableValues = getAvailableValues()

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Filter Companies</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="relative">
              <button
                onClick={() => setIsFieldDropdownOpen(!isFieldDropdownOpen)}
                className="flex items-center gap-2 px-3 py-2 border rounded-md bg-background min-w-24 justify-between"
              >
                <span className="text-sm">{selectedFieldOption?.label}</span>
                <ChevronDown className="h-4 w-4" />
              </button>
              
              {isFieldDropdownOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-10" 
                    onClick={() => setIsFieldDropdownOpen(false)}
                  />
                  <div className="absolute top-full mt-1 left-0 z-20 w-full bg-white border rounded-md shadow-lg">
                    {fieldOptions.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => {
                          setSelectedField(option.value)
                          setIsFieldDropdownOpen(false)
                          setSelectedValues([])
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            
            <span className="text-sm text-muted-foreground">is one of</span>
            
            <div className="relative flex-1">
              <button
                onClick={() => setIsValueDropdownOpen(!isValueDropdownOpen)}
                className="flex items-center gap-2 px-3 py-2 border rounded-md bg-background w-full justify-between"
              >
                <span className="text-sm">
                  {selectedValues.length === 0 
                    ? 'Select values...' 
                    : `${selectedValues.length} selected`
                  }
                </span>
                <ChevronDown className="h-4 w-4" />
              </button>
              
              {isValueDropdownOpen && (
                <>
                  <div 
                    className="fixed inset-0 z-10" 
                    onClick={() => setIsValueDropdownOpen(false)}
                  />
                  <div className="absolute top-full mt-1 left-0 z-20 w-full bg-white border rounded-md shadow-lg max-h-60 overflow-auto">
                    {availableValues.map((option) => (
                      <label
                        key={option.value}
                        className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={selectedValues.includes(option.value)}
                          onChange={() => handleValueSelect(option.value)}
                          className="rounded border-gray-300"
                        />
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${option.className}`}>
                          {option.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
          
          {filters.criteria.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Active Filters:</h4>
              {filters.criteria.map((criterion) => (
                <div key={criterion.field} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {fieldOptions.find(f => f.value === criterion.field)?.label}:
                    </span>
                    <div className="flex gap-1 flex-wrap">
                      {criterion.values.map((value) => (
                        <span key={value} className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                          {getValueLabel(criterion.field, value)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button
                    onClick={() => handleRemoveFilter(criterion.field)}
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          
          <div className="flex gap-2 pt-4">
            <Button onClick={handleApply} className="flex-1">
              Apply Filters
            </Button>
            <Button onClick={handleClear} variant="outline" className="flex-1">
              Clear All
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

