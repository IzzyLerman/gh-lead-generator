'use client'

import React, { useState, useRef, useEffect } from 'react'
import { ChevronDown, Check } from 'lucide-react'

interface StatusOption {
  value: string
  label: string
  className: string
}

interface StatusDropdownProps {
  currentStatus: string
  statusOptions: StatusOption[]
  onStatusChange: (newStatus: string) => Promise<void>
  disabled?: boolean
}

export function StatusDropdown({ currentStatus, statusOptions, onStatusChange, disabled = false }: StatusDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)

  const currentOption = statusOptions.find(option => option.value === currentStatus)
  
  const handleStatusSelect = async (newStatus: string) => {
    if (newStatus === currentStatus || isUpdating) return
    
    setIsUpdating(true)
    try {
      await onStatusChange(newStatus)
      setIsOpen(false)
    } catch (error) {
      console.error('Failed to update status:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const updateDropdownPosition = () => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      const dropdownHeight = 240 // max-h-60 = 240px
      const viewportHeight = window.innerHeight
      const dropdownWidth = 192 // w-48 = 192px
      
      // Calculate optimal position
      let top = rect.bottom + 4
      let left = Math.max(8, rect.right - dropdownWidth)
      
      // If dropdown would go below viewport, position it above the button
      if (top + dropdownHeight > viewportHeight - 20) {
        top = rect.top - dropdownHeight - 4
      }
      
      // Ensure dropdown stays within viewport bounds
      top = Math.max(8, Math.min(top, viewportHeight - dropdownHeight - 8))
      left = Math.max(8, Math.min(left, window.innerWidth - dropdownWidth - 8))
      
      setDropdownPosition({ top, left })
    }
  }

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled && !isUpdating) {
      if (!isOpen) {
        updateDropdownPosition()
      }
      setIsOpen(!isOpen)
    }
  }

  useEffect(() => {
    if (isOpen) {
      updateDropdownPosition()
      window.addEventListener('scroll', updateDropdownPosition, true)
      window.addEventListener('resize', updateDropdownPosition)
      
      return () => {
        window.removeEventListener('scroll', updateDropdownPosition, true)
        window.removeEventListener('resize', updateDropdownPosition)
      }
    }
  }, [isOpen])

  return (
    <div className="relative inline-block text-left">
      <button
        ref={buttonRef}
        onClick={handleClick}
        disabled={disabled || isUpdating}
        className={`
          ${currentOption?.className || 'bg-gray-100 text-gray-800'}
          inline-flex items-center px-2 py-1 rounded-full text-xs font-medium
          transition-colors duration-150 cursor-pointer
          hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50
          ${isOpen ? 'ring-2 ring-blue-500 ring-offset-1' : ''}
        `}
      >
        <span>{currentOption?.label || currentStatus}</span>
        <ChevronDown className={`ml-1 h-3 w-3 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="fixed z-50 w-48 bg-white rounded-md border shadow-lg" 
               style={{
                 top: `${dropdownPosition.top}px`,
                 left: `${dropdownPosition.left}px`
               }}>
            <div className="py-1 max-h-60 overflow-auto">
              {statusOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleStatusSelect(option.value)}
                  disabled={isUpdating}
                  className={`
                    w-full text-left px-3 py-2 text-sm hover:bg-gray-50 
                    disabled:cursor-not-allowed disabled:opacity-50
                    flex items-center justify-between
                    ${option.value === currentStatus ? 'bg-blue-50' : ''}
                  `}
                >
                  <span className={`
                    inline-flex items-center px-2 py-1 rounded-full text-xs font-medium
                    ${option.className}
                  `}>
                    {option.label}
                  </span>
                  {option.value === currentStatus && (
                    <Check className="h-3 w-3 text-blue-600" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}