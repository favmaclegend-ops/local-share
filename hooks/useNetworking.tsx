'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import { DeviceDiscovery, Device, DeviceDiscoveryEvents, ReceivedFile, FileTransferProgress } from '../lib/device-discovery'

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
  refreshDevices: () => void
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

export function NetworkingProvider({ children, initialDeviceName }: NetworkingProviderProps) {
  const [deviceDiscovery, setDeviceDiscovery] = useState<DeviceDiscovery | null>(null)
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

  // Initialize device discovery when component mounts
  useEffect(() => {
    // Only initialize on client side
    if (typeof window === 'undefined') return
    
    const initializeDeviceDiscovery = async () => {
      try {
        const discovery = new DeviceDiscovery(state.deviceName)
        
        // Set up event handlers
        const handlers: DeviceDiscoveryEvents = {
          onDevicesUpdated: (devices: Device[]) => {
            setState(prev => ({
              ...prev,
              devices: devices.filter(device => device.id !== prev.deviceId) // Filter out self
            }))
          },

          onDeviceRegistered: (deviceId: string, deviceName: string) => {
            setState(prev => ({
              ...prev,
              deviceId,
              deviceName,
              isConnected: true,
              isLoading: false,
              error: null
            }))
          },

          onConnectionStateChanged: (deviceId: string, connectionState: string) => {
            setState(prev => {
              const newConnectionStates = new Map(prev.connectionStates)
              newConnectionStates.set(deviceId, connectionState)
              return {
                ...prev,
                connectionStates: newConnectionStates
              }
            })
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
        }

        discovery.setEventHandlers(handlers)
        setDeviceDiscovery(discovery)
      } catch (error) {
        console.error('Failed to initialize device discovery:', error)
        setState(prev => ({
          ...prev,
          error: 'Failed to initialize networking',
          isLoading: false
        }))
      }
    }

    initializeDeviceDiscovery()

    // Cleanup on unmount
    return () => {
      if (deviceDiscovery) {
        deviceDiscovery.disconnect()
      }
    }
  }, []) // Empty dependency array - only run once

  // Update device name when it changes
  useEffect(() => {
    if (deviceDiscovery && !state.isConnected) {
      const discovery = new DeviceDiscovery(state.deviceName)
      
      const handlers: DeviceDiscoveryEvents = {
        onDevicesUpdated: (devices: Device[]) => {
          setState(prev => ({
            ...prev,
            devices: devices.filter(device => device.id !== prev.deviceId)
          }))
        },

        onDeviceRegistered: (deviceId: string, deviceName: string) => {
          setState(prev => ({
            ...prev,
            deviceId,
            deviceName,
            isConnected: true,
            isLoading: false,
            error: null
          }))
        },

        onConnectionStateChanged: (deviceId: string, connectionState: string) => {
          setState(prev => {
            const newConnectionStates = new Map(prev.connectionStates)
            newConnectionStates.set(deviceId, connectionState)
            return {
              ...prev,
              connectionStates: newConnectionStates
            }
          })
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
      }

      discovery.setEventHandlers(handlers)
      setDeviceDiscovery(discovery)
    }
  }, [state.deviceName])

  const connect = useCallback(async () => {
    if (!deviceDiscovery || state.isConnected) return

    setState(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      await deviceDiscovery.connect()
      // State will be updated by the onDeviceRegistered callback
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to connect',
        isLoading: false
      }))
    }
  }, [deviceDiscovery, state.isConnected])

  const disconnect = useCallback(() => {
    if (!deviceDiscovery) return

    deviceDiscovery.disconnect()
    setState(prev => ({
      ...prev,
      isConnected: false,
      deviceId: null,
      devices: [],
      connectionStates: new Map(),
      isLoading: false
    }))
  }, [deviceDiscovery])

  const refreshDevices = useCallback(() => {
    if (deviceDiscovery && state.isConnected) {
      deviceDiscovery.refreshDevices()
    }
  }, [deviceDiscovery, state.isConnected])

  const connectToDevice = useCallback(async (deviceId: string) => {
    if (!deviceDiscovery || !state.isConnected) {
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
      await deviceDiscovery.connectToDevice(deviceId)
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to connect to device'
      }))
      
      // Reset connection state on error
      setState(prev => {
        const newConnectionStates = new Map(prev.connectionStates)
        newConnectionStates.set(deviceId, 'failed')
        return {
          ...prev,
          connectionStates: newConnectionStates
        }
      })
      throw error
    }
  }, [deviceDiscovery, state.isConnected])

  const sendFile = useCallback(async (deviceId: string, file: File) => {
    if (!deviceDiscovery) {
      throw new Error('Device discovery not initialized')
    }

    try {
      await deviceDiscovery.sendFileToDevice(deviceId, file)
    } catch (error) {
      setState(prev => ({
        ...prev,
        error: error instanceof Error ? error.message : 'Failed to send file'
      }))
      throw error
    }
  }, [deviceDiscovery])

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
    refreshDevices,
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

export function useNetworking(): NetworkingContextType {
  const context = useContext(NetworkingContext)
  if (!context) {
    throw new Error('useNetworking must be used within a NetworkingProvider')
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
