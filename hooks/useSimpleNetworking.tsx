'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { SimpleNetworking, Device, ReceivedFile, FileTransferProgress } from '../lib/simple-networking'

interface NetworkingState {
  isConnected: boolean
  deviceId: string | null
  deviceName: string
  devices: Device[]
  connectionStates: Map<string, string>
  error: string | null
  isLoading: boolean
  receivedFiles: ReceivedFile[]
  fileTransferProgress: FileTransferProgress | null
}

interface NetworkingActions {
  connect: () => Promise<void>
  disconnect: () => void
  connectToDevice: (deviceId: string) => Promise<void>
  sendFile: (deviceId: string, file: File) => Promise<void>
  setDeviceName: (name: string) => void
  clearError: () => void
  clearReceivedFiles: () => void
  downloadFile: (file: ReceivedFile) => void
}

type NetworkingContextType = NetworkingState & NetworkingActions

const NetworkingContext = createContext<NetworkingContextType | null>(null)

interface NetworkingProviderProps {
  children: ReactNode
  initialDeviceName?: string
}

export function SimpleNetworkingProvider({ children, initialDeviceName }: NetworkingProviderProps) {
  const [networking, setNetworking] = useState<SimpleNetworking | null>(null)
  const [state, setState] = useState<NetworkingState>({
    isConnected: false,
    deviceId: null,
    deviceName: initialDeviceName || getDefaultDeviceName(),
    devices: [],
    connectionStates: new Map(),
    error: null,
    isLoading: false,
    receivedFiles: [],
    fileTransferProgress: null
  })

  // Initialize networking when component mounts
  useEffect(() => {
    if (typeof window === 'undefined') return

    const initNetworking = async () => {
      try {
        const net = new SimpleNetworking(state.deviceName)
        
        net.setEventHandlers({
          onDevicesUpdated: (devices: Device[]) => {
            setState(prev => ({ ...prev, devices }))
          },

          onFileReceived: (deviceId: string, file: ReceivedFile) => {
            console.log(`📥 File received from ${deviceId}: ${file.name}`)
            setState(prev => ({
              ...prev,
              receivedFiles: [...prev.receivedFiles, file],
              fileTransferProgress: null
            }))
          },

          onFileTransferProgress: (progress: FileTransferProgress) => {
            setState(prev => ({
              ...prev,
              fileTransferProgress: progress
            }))
          },

          onError: (error: string) => {
            setState(prev => ({
              ...prev,
              error,
              isLoading: false
            }))
          }
        })

        setNetworking(net)
      } catch (error) {
        console.error('Failed to initialize networking:', error)
        setState(prev => ({
          ...prev,
          error: 'Failed to initialize networking',
          isLoading: false
        }))
      }
    }

    initNetworking()

    return () => {
      if (networking) {
        networking.disconnect()
      }
    }
  }, [])

  const connect = useCallback(async () => {
    if (!networking || state.isConnected) return

    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      await networking.connect()
      setState(prev => ({
        ...prev,
        isConnected: true,
        isLoading: false
      }))
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to connect',
        isLoading: false
      }))
    }
  }, [networking, state.isConnected])

  const disconnect = useCallback(() => {
    if (!networking) return

    networking.disconnect()
    setState(prev => ({
      ...prev,
      isConnected: false,
      deviceId: null,
      devices: [],
      connectionStates: new Map(),
      isLoading: false
    }))
  }, [networking])

  const connectToDevice = useCallback(async (deviceId: string) => {
    if (!networking || !state.isConnected) {
      throw new Error('Not connected to signaling server')
    }

    setState(prev => {
      const newConnectionStates = new Map(prev.connectionStates)
      newConnectionStates.set(deviceId, 'connecting')
      return {
        ...prev,
        connectionStates: newConnectionStates,
        error: null
      }
    })

    try {
      await networking.connectToDevice(deviceId)
      setState(prev => {
        const newConnectionStates = new Map(prev.connectionStates)
        newConnectionStates.set(deviceId, 'connected')
        return {
          ...prev,
          connectionStates: newConnectionStates
        }
      })
    } catch (error) {
      setState(prev => {
        const newConnectionStates = new Map(prev.connectionStates)
        newConnectionStates.set(deviceId, 'failed')
        return {
          ...prev,
          connectionStates: newConnectionStates,
          error: error instanceof Error ? error.message : 'Failed to connect to device'
        }
      })
      throw error
    }
  }, [networking, state.isConnected])

  const sendFile = useCallback(async (deviceId: string, file: File) => {
    if (!networking) {
      throw new Error('Networking not initialized')
    }

    try {
      await networking.sendFile(deviceId, file)
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to send file'
      }))
      throw error
    }
  }, [networking])

  const setDeviceName = useCallback((name: string) => {
    setState(prev => ({ ...prev, deviceName: name }))
  }, [])

  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }))
  }, [])

  const clearReceivedFiles = useCallback(() => {
    // Clean up object URLs to prevent memory leaks
    state.receivedFiles.forEach(file => {
      URL.revokeObjectURL(file.url)
    })
    setState(prev => ({ ...prev, receivedFiles: [] }))
  }, [state.receivedFiles])

  const downloadFile = useCallback((file: ReceivedFile) => {
    const a = document.createElement('a')
    a.href = file.url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    console.log(`💾 Downloaded file: ${file.name}`)
  }, [])

  const contextValue: NetworkingContextType = {
    ...state,
    connect,
    disconnect,
    connectToDevice,
    sendFile,
    setDeviceName,
    clearError,
    clearReceivedFiles,
    downloadFile
  }

  return (
    <NetworkingContext.Provider value={contextValue}>
      {children}
    </NetworkingContext.Provider>
  )
}

export function useSimpleNetworking(): NetworkingContextType {
  const context = useContext(NetworkingContext)
  if (!context) {
    throw new Error('useSimpleNetworking must be used within a SimpleNetworkingProvider')
  }
  return context
}

function getDefaultDeviceName(): string {
  if (typeof window === 'undefined') {
    return 'Unknown Device'
  }

  // Try to get a reasonable device name
  const userAgent = navigator.userAgent
  
  if (userAgent.includes('Mobile')) {
    if (userAgent.includes('iPhone')) return 'iPhone'
    if (userAgent.includes('Android')) return 'Android Device'
    return 'Mobile Device'
  }
  
  if (userAgent.includes('Macintosh')) return 'Mac'
  if (userAgent.includes('Windows')) return 'Windows PC'
  if (userAgent.includes('Linux')) return 'Linux PC'
  
  return 'Desktop Computer'
}
