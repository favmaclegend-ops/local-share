import { io } from 'socket.io-client'
import type { Socket } from 'socket.io-client'
import { WebRTCManager, SignalingMessage } from './webrtc-manager'

export interface Device {
  id: string
  name: string
  status: 'online' | 'offline'
}

export interface DeviceConnection {
  device: Device
  webrtc: WebRTCManager
  status: 'connecting' | 'connected' | 'disconnected' | 'failed'
}

export interface ReceivedFile {
  name: string
  size: number
  mimeType: string
  blob: Blob
  url: string
  receivedAt: Date
  fromDevice: string
}

export interface FileTransferProgress {
  deviceId: string
  fileName: string
  totalSize: number
  receivedSize: number
  progress: number
}

export interface DeviceDiscoveryEvents {
  onDevicesUpdated: (devices: Device[]) => void
  onDeviceRegistered: (deviceId: string, deviceName: string) => void
  onConnectionStateChanged: (deviceId: string, state: string) => void
  onFileReceived: (deviceId: string, file: ReceivedFile) => void
  onFileTransferProgress: (progress: FileTransferProgress) => void
  onError: (error: string) => void
}

export class DeviceDiscovery {
  private socket: Socket | null = null
  private deviceId: string | null = null
  private deviceName: string
  private connections: Map<string, DeviceConnection> = new Map()
  private handlers: Partial<DeviceDiscoveryEvents> = {}
  private heartbeatInterval: NodeJS.Timeout | null = null
  
  // File transfer state
  private fileTransfers: Map<string, {
    fileName: string
    totalSize: number
    mimeType: string
    chunks: ArrayBuffer[]
    receivedSize: number
  }> = new Map()

  constructor(deviceName: string) {
    this.deviceName = deviceName || `Device-${Date.now()}`
  }

  public setEventHandlers(handlers: Partial<DeviceDiscoveryEvents>) {
    this.handlers = { ...this.handlers, ...handlers }
  }

  public async connect(serverUrl = 'http://localhost:3000'): Promise<void> {
    if (this.socket?.connected) {
      console.log('Already connected')
      return
    }

    return new Promise((resolve, reject) => {
      this.socket = io(serverUrl, {
        transports: ['websocket', 'polling']
      })

      this.socket.on('connect', () => {
        console.log('Connected to signaling server')
        this.registerDevice()
        this.startHeartbeat()
        resolve()
      })

      this.socket.on('connect_error', (error) => {
        console.error('Connection error:', error)
        reject(error)
      })

      this.setupSocketHandlers()
    })
  }

  public disconnect(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    // Close all WebRTC connections
    for (const connection of this.connections.values()) {
      connection.webrtc.close()
    }
    this.connections.clear()

    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }

    this.deviceId = null
  }

  public refreshDevices(): void {
    if (this.socket?.connected) {
      this.socket.emit('get-devices')
    }
  }

  public async connectToDevice(targetDeviceId: string): Promise<void> {
    if (!this.deviceId || !this.socket?.connected) {
      throw new Error('Not connected to signaling server')
    }

    if (this.connections.has(targetDeviceId)) {
      console.log(`Already have connection to device ${targetDeviceId}`)
      return
    }

    const targetDevice = await this.getDeviceById(targetDeviceId)
    if (!targetDevice) {
      throw new Error('Target device not found')
    }

    const webrtc = new WebRTCManager(this.deviceId!)
    this.setupWebRTCHandlers(webrtc, targetDeviceId)

    const connection: DeviceConnection = {
      device: targetDevice,
      webrtc,
      status: 'connecting'
    }
    this.connections.set(targetDeviceId, connection)

    try {
      const offer = await webrtc.createOffer(targetDeviceId)
      this.socket.emit('webrtc-signal', offer)
      
      console.log(`Sent offer to device ${targetDeviceId}`)
    } catch (error) {
      console.error('Failed to create offer:', error)
      this.connections.delete(targetDeviceId)
      throw error
    }
  }

  public async sendFileToDevice(targetDeviceId: string, file: File): Promise<void> {
    const connection = this.connections.get(targetDeviceId)
    if (!connection || connection.status !== 'connected') {
      throw new Error('No active connection to target device')
    }

    try {
      await connection.webrtc.sendFile(file)
      console.log(`File sent successfully to ${targetDeviceId}`)
    } catch (error) {
      console.error('Failed to send file:', error)
      throw error
    }
  }

  public getConnectedDevices(): Device[] {
    return Array.from(this.connections.values())
      .filter(conn => conn.status === 'connected')
      .map(conn => conn.device)
  }

  public getConnectionStatus(deviceId: string): string | null {
    return this.connections.get(deviceId)?.status || null
  }

  public isConnectedToDevice(deviceId: string): boolean {
    return this.connections.get(deviceId)?.status === 'connected'
  }

  private async getDeviceById(deviceId: string): Promise<Device | null> {
    // In a real implementation, you might want to cache this or request it from the server
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve(null)
        return
      }

      // We'll simulate this for now - in practice, you might want to add an API for this
      this.socket.emit('get-devices')
      
      const timeout = setTimeout(() => resolve(null), 5000)
      
      this.socket.once('devices-updated', (devices: Device[]) => {
        clearTimeout(timeout)
        const device = devices.find(d => d.id === deviceId) || null
        resolve(device)
      })
    })
  }

  private registerDevice(): void {
    if (!this.socket) return

    this.socket.emit('register-device', {
      name: this.deviceName
    })
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.socket?.connected && this.deviceId) {
        this.socket.emit('heartbeat', this.deviceId)
      }
    }, 15000) // Send heartbeat every 15 seconds
  }

  private setupSocketHandlers(): void {
    if (!this.socket) return

    this.socket.on('device-registered', (data: { deviceId: string; name: string }) => {
      this.deviceId = data.deviceId
      console.log(`Device registered with ID: ${data.deviceId}`)
      this.handlers.onDeviceRegistered?.(data.deviceId, data.name)
    })

    this.socket.on('devices-updated', (devices: Device[]) => {
      console.log('Devices updated:', devices)
      this.handlers.onDevicesUpdated?.(devices)
    })

    this.socket.on('webrtc-signal', async (message: SignalingMessage) => {
      console.log('Received WebRTC signal:', message.type)
      await this.handleWebRTCSignal(message)
    })

    this.socket.on('error', (error: { message: string }) => {
      console.error('Socket error:', error.message)
      this.handlers.onError?.(error.message)
    })

    this.socket.on('disconnect', () => {
      console.log('Disconnected from signaling server')
      this.deviceId = null
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval)
        this.heartbeatInterval = null
      }
    })
  }

  private async handleWebRTCSignal(message: SignalingMessage): Promise<void> {
    if (!this.deviceId || !this.socket) return

    try {
      switch (message.type) {
        case 'offer':
          await this.handleOffer(message)
          break
        case 'answer':
          await this.handleAnswer(message)
          break
        case 'ice-candidate':
          await this.handleIceCandidate(message)
          break
      }
    } catch (error) {
      console.error('Failed to handle WebRTC signal:', error)
      this.handlers.onError?.(`WebRTC signaling error: ${error}`)
    }
  }

  private async handleOffer(message: SignalingMessage): Promise<void> {
    const sourceDevice = await this.getDeviceById(message.sourceDeviceId)
    if (!sourceDevice) {
      console.error('Unknown source device for offer')
      return
    }

    const webrtc = new WebRTCManager(this.deviceId!)
    this.setupWebRTCHandlers(webrtc, message.sourceDeviceId)

    const connection: DeviceConnection = {
      device: sourceDevice,
      webrtc,
      status: 'connecting'
    }
    this.connections.set(message.sourceDeviceId, connection)

    const answer = await webrtc.handleOffer(message)
    this.socket!.emit('webrtc-signal', answer)
  }

  private async handleAnswer(message: SignalingMessage): Promise<void> {
    const connection = this.connections.get(message.sourceDeviceId)
    if (!connection) {
      console.error('No connection found for answer')
      return
    }

    await connection.webrtc.handleAnswer(message)
  }

  private async handleIceCandidate(message: SignalingMessage): Promise<void> {
    const connection = this.connections.get(message.sourceDeviceId)
    if (!connection) {
      console.error('No connection found for ICE candidate')
      return
    }

    await connection.webrtc.handleIceCandidate(message)
  }

  private setupWebRTCHandlers(webrtc: WebRTCManager, deviceId: string): void {
    webrtc.setEventHandlers({
      onConnectionStateChange: (state) => {
        console.log(`WebRTC connection state with ${deviceId}: ${state}`)
        
        const connection = this.connections.get(deviceId)
        if (connection) {
          switch (state) {
            case 'connected':
              connection.status = 'connected'
              break
            case 'connecting':
              connection.status = 'connecting'
              break
            case 'failed':
            case 'closed':
              connection.status = 'failed'
              break
            default:
              connection.status = 'disconnected'
          }
          
          this.handlers.onConnectionStateChanged?.(deviceId, connection.status)
        }
      },

      onDataChannelOpen: () => {
        console.log(`Data channel opened with ${deviceId}`)
        const connection = this.connections.get(deviceId)
        if (connection) {
          connection.status = 'connected'
          this.handlers.onConnectionStateChanged?.(deviceId, 'connected')
        }
      },

      onDataChannelMessage: (event) => {
        // Handle incoming messages/files
        this.handleDataChannelMessage(deviceId, event)
      },

      onDataChannelError: (error) => {
        console.error(`Data channel error with ${deviceId}:`, error)
        this.handlers.onError?.(`Data channel error with ${deviceId}`)
      },

      onIceCandidate: (candidate) => {
        if (candidate && this.socket && this.deviceId) {
          this.socket.emit('webrtc-signal', {
            type: 'ice-candidate',
            data: candidate,
            targetDeviceId: deviceId,
            sourceDeviceId: this.deviceId
          })
        }
      }
    })
  }

  private handleDataChannelMessage(deviceId: string, event: MessageEvent): void {
    try {
      // Try to parse as JSON first (for control messages)
      if (typeof event.data === 'string') {
        const message = JSON.parse(event.data)
        
        switch (message.type) {
          case 'file-start':
            console.log(`📥 File transfer started: ${message.name} (${message.size} bytes)`)
            console.log(`📄 MIME type: ${message.mimeType}`)
            
            // Initialize file transfer state
            this.fileTransfers.set(deviceId, {
              fileName: message.name,
              totalSize: message.size,
              mimeType: message.mimeType,
              chunks: [],
              receivedSize: 0
            })
            
            // Notify progress (0%)
            this.handlers.onFileTransferProgress?.({
              deviceId,
              fileName: message.name,
              totalSize: message.size,
              receivedSize: 0,
              progress: 0
            })
            break
            
          case 'file-end':
            console.log('📦 File transfer completed - reconstructing file')
            this.reconstructFile(deviceId)
            break
            
          default:
            console.log('📨 Received message:', message)
        }
      } else if (event.data instanceof ArrayBuffer) {
        // Handle file chunks
        this.handleFileChunk(deviceId, event.data)
      }
    } catch (error) {
      console.error('❌ Failed to handle data channel message:', error)
    }
  }
  
  private handleFileChunk(deviceId: string, chunk: ArrayBuffer): void {
    const transfer = this.fileTransfers.get(deviceId)
    if (!transfer) {
      console.error('❌ Received file chunk but no transfer in progress')
      return
    }
    
    // Add chunk to array
    transfer.chunks.push(chunk)
    transfer.receivedSize += chunk.byteLength
    
    const progress = (transfer.receivedSize / transfer.totalSize) * 100
    
    console.log(`📦 Received chunk: ${chunk.byteLength} bytes (${progress.toFixed(1)}% complete)`)
    
    // Notify progress
    this.handlers.onFileTransferProgress?.({
      deviceId,
      fileName: transfer.fileName,
      totalSize: transfer.totalSize,
      receivedSize: transfer.receivedSize,
      progress
    })
  }
  
  private reconstructFile(deviceId: string): void {
    const transfer = this.fileTransfers.get(deviceId)
    if (!transfer) {
      console.error('❌ Cannot reconstruct file - no transfer data')
      return
    }
    
    try {
      // Combine all chunks into a single blob
      const blob = new Blob(transfer.chunks, { type: transfer.mimeType })
      const url = URL.createObjectURL(blob)
      
      const receivedFile: ReceivedFile = {
        name: transfer.fileName,
        size: transfer.totalSize,
        mimeType: transfer.mimeType,
        blob,
        url,
        receivedAt: new Date(),
        fromDevice: deviceId
      }
      
      console.log(`✅ File reconstructed successfully: ${transfer.fileName}`)
      console.log(`💾 File size: ${blob.size} bytes`)
      console.log(`🔗 Download URL created: ${url.substring(0, 50)}...`)
      
      // Notify file received
      this.handlers.onFileReceived?.(deviceId, receivedFile)
      
      // Clean up transfer state
      this.fileTransfers.delete(deviceId)
      
    } catch (error) {
      console.error('❌ Failed to reconstruct file:', error)
      this.fileTransfers.delete(deviceId)
    }
  }
}
