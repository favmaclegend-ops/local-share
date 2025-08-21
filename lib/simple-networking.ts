'use client'

// Simple client-side only implementation to avoid SSR issues

export interface Device {
  id: string
  name: string
  status: 'online' | 'offline'
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

export class SimpleNetworking {
  private socket: any = null
  private deviceId: string | null = null
  private deviceName: string
  private connections: Map<string, any> = new Map()
  private onDevicesUpdated?: (devices: Device[]) => void
  private onFileReceived?: (deviceId: string, file: ReceivedFile) => void
  private onFileTransferProgress?: (progress: FileTransferProgress) => void
  private onError?: (error: string) => void
  private fileTransfers: Map<string, any> = new Map()

  constructor(deviceName: string) {
    this.deviceName = deviceName
  }

  public setEventHandlers(handlers: {
    onDevicesUpdated?: (devices: Device[]) => void
    onFileReceived?: (deviceId: string, file: ReceivedFile) => void
    onFileTransferProgress?: (progress: FileTransferProgress) => void
    onError?: (error: string) => void
  }) {
    this.onDevicesUpdated = handlers.onDevicesUpdated
    this.onFileReceived = handlers.onFileReceived
    this.onFileTransferProgress = handlers.onFileTransferProgress
    this.onError = handlers.onError
  }

  public async connect(): Promise<void> {
    if (typeof window === 'undefined') {
      throw new Error('Networking only works in browser')
    }

    try {
      // Dynamic import to avoid SSR issues
      const { io } = await import('socket.io-client')
      
      this.socket = io('http://localhost:3000', {
        transports: ['websocket', 'polling']
      })

      return new Promise((resolve, reject) => {
        this.socket.on('connect', () => {
          console.log('🌐 Connected to signaling server')
          this.registerDevice()
          resolve()
        })

        this.socket.on('connect_error', (error: any) => {
          console.error('❌ Connection error:', error)
          reject(error)
        })

        this.setupSocketHandlers()
      })
    } catch (error) {
      console.error('❌ Failed to initialize networking:', error)
      throw error
    }
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
    this.deviceId = null
    this.connections.clear()
    this.fileTransfers.clear()
  }

  public async connectToDevice(deviceId: string): Promise<void> {
    if (!this.deviceId || !this.socket?.connected) {
      throw new Error('Not connected to signaling server')
    }

    console.log(`🔗 Connecting to device: ${deviceId}`)

    try {
      // Create WebRTC connection
      const peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      })

      // Create data channel
      const dataChannel = peerConnection.createDataChannel('fileTransfer', {
        ordered: true
      })

      this.setupDataChannelHandlers(dataChannel, deviceId)
      this.connections.set(deviceId, { peerConnection, dataChannel })

      // Set up WebRTC event handlers
      peerConnection.onicecandidate = (event) => {
        if (event.candidate && this.socket) {
          this.socket.emit('webrtc-signal', {
            type: 'ice-candidate',
            data: event.candidate,
            targetDeviceId: deviceId,
            sourceDeviceId: this.deviceId
          })
        }
      }

      // Create and send offer
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)

      this.socket.emit('webrtc-signal', {
        type: 'offer',
        data: offer,
        targetDeviceId: deviceId,
        sourceDeviceId: this.deviceId
      })

      console.log(`📤 Sent offer to ${deviceId}`)
    } catch (error) {
      console.error('❌ Failed to connect to device:', error)
      throw error
    }
  }

  public async sendFile(deviceId: string, file: File): Promise<void> {
    const connection = this.connections.get(deviceId)
    if (!connection?.dataChannel || connection.dataChannel.readyState !== 'open') {
      throw new Error('No active connection to device')
    }

    console.log(`📤 Starting file transfer: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`)

    const CHUNK_SIZE = 16384 // 16KB chunks
    const reader = new FileReader()
    let offset = 0

    // Send file metadata
    connection.dataChannel.send(JSON.stringify({
      type: 'file-start',
      name: file.name,
      size: file.size,
      mimeType: file.type
    }))

    return new Promise((resolve, reject) => {
      const sendChunk = () => {
        const slice = file.slice(offset, offset + CHUNK_SIZE)
        reader.readAsArrayBuffer(slice)
      }

      reader.onload = (event) => {
        if (!event.target?.result) {
          reject(new Error('Failed to read file chunk'))
          return
        }

        try {
          connection.dataChannel.send(event.target.result as ArrayBuffer)
          offset += CHUNK_SIZE

          const progress = (offset / file.size) * 100
          console.log(`📦 Sent chunk: ${progress.toFixed(1)}% complete`)

          if (offset < file.size) {
            sendChunk()
          } else {
            // File transfer complete
            connection.dataChannel.send(JSON.stringify({ type: 'file-end' }))
            console.log('✅ File transfer completed!')
            resolve()
          }
        } catch (error) {
          reject(error)
        }
      }

      reader.onerror = () => reject(new Error('Failed to read file'))
      sendChunk()
    })
  }

  private registerDevice(): void {
    if (!this.socket) return

    this.socket.emit('register-device', {
      name: this.deviceName
    })
  }

  private setupSocketHandlers(): void {
    if (!this.socket) return

    this.socket.on('device-registered', (data: { deviceId: string; name: string }) => {
      this.deviceId = data.deviceId
      console.log(`📱 Device registered: ${data.name} (${data.deviceId.slice(0, 8)}...)`)
    })

    this.socket.on('devices-updated', (devices: Device[]) => {
      console.log('📋 Devices updated:', devices.length)
      const filteredDevices = devices.filter(d => d.id !== this.deviceId)
      this.onDevicesUpdated?.(filteredDevices)
    })

    this.socket.on('webrtc-signal', async (message: any) => {
      await this.handleWebRTCSignal(message)
    })
  }

  private async handleWebRTCSignal(message: any): Promise<void> {
    if (!this.deviceId) return

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
      console.error('❌ WebRTC signaling error:', error)
      this.onError?.(`WebRTC error: ${error}`)
    }
  }

  private async handleOffer(message: any): Promise<void> {
    console.log(`📞 Received offer from ${message.sourceDeviceId}`)

    const peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    })

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.socket) {
        this.socket.emit('webrtc-signal', {
          type: 'ice-candidate',
          data: event.candidate,
          targetDeviceId: message.sourceDeviceId,
          sourceDeviceId: this.deviceId
        })
      }
    }

    peerConnection.ondatachannel = (event) => {
      this.setupDataChannelHandlers(event.channel, message.sourceDeviceId)
      this.connections.set(message.sourceDeviceId, { 
        peerConnection, 
        dataChannel: event.channel 
      })
    }

    await peerConnection.setRemoteDescription(message.data)
    const answer = await peerConnection.createAnswer()
    await peerConnection.setLocalDescription(answer)

    this.socket.emit('webrtc-signal', {
      type: 'answer',
      data: answer,
      targetDeviceId: message.sourceDeviceId,
      sourceDeviceId: this.deviceId
    })

    console.log(`📤 Sent answer to ${message.sourceDeviceId}`)
  }

  private async handleAnswer(message: any): Promise<void> {
    console.log(`📞 Received answer from ${message.sourceDeviceId}`)
    const connection = this.connections.get(message.sourceDeviceId)
    if (connection?.peerConnection) {
      await connection.peerConnection.setRemoteDescription(message.data)
    }
  }

  private async handleIceCandidate(message: any): Promise<void> {
    const connection = this.connections.get(message.sourceDeviceId)
    if (connection?.peerConnection && message.data) {
      await connection.peerConnection.addIceCandidate(message.data)
    }
  }

  private setupDataChannelHandlers(dataChannel: RTCDataChannel, deviceId: string): void {
    dataChannel.onopen = () => {
      console.log(`🎉 Data channel opened with ${deviceId}`)
    }

    dataChannel.onmessage = (event) => {
      this.handleDataChannelMessage(deviceId, event)
    }

    dataChannel.onerror = (error) => {
      console.error(`❌ Data channel error with ${deviceId}:`, error)
      this.onError?.(`Data channel error with ${deviceId}`)
    }
  }

  private handleDataChannelMessage(deviceId: string, event: MessageEvent): void {
    try {
      if (typeof event.data === 'string') {
        const message = JSON.parse(event.data)
        
        switch (message.type) {
          case 'file-start':
            console.log(`📥 File transfer started: ${message.name}`)
            this.fileTransfers.set(deviceId, {
              fileName: message.name,
              totalSize: message.size,
              mimeType: message.mimeType,
              chunks: [],
              receivedSize: 0
            })
            
            this.onFileTransferProgress?.({
              deviceId,
              fileName: message.name,
              totalSize: message.size,
              receivedSize: 0,
              progress: 0
            })
            break
            
          case 'file-end':
            console.log('📦 File transfer completed - reconstructing')
            this.reconstructFile(deviceId)
            break
        }
      } else if (event.data instanceof ArrayBuffer) {
        this.handleFileChunk(deviceId, event.data)
      }
    } catch (error) {
      console.error('❌ Failed to handle data channel message:', error)
    }
  }

  private handleFileChunk(deviceId: string, chunk: ArrayBuffer): void {
    const transfer = this.fileTransfers.get(deviceId)
    if (!transfer) return

    transfer.chunks.push(chunk)
    transfer.receivedSize += chunk.byteLength

    const progress = (transfer.receivedSize / transfer.totalSize) * 100
    console.log(`📦 Received chunk: ${progress.toFixed(1)}% complete`)

    this.onFileTransferProgress?.({
      deviceId,
      fileName: transfer.fileName,
      totalSize: transfer.totalSize,
      receivedSize: transfer.receivedSize,
      progress
    })
  }

  private reconstructFile(deviceId: string): void {
    const transfer = this.fileTransfers.get(deviceId)
    if (!transfer) return

    try {
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

      console.log(`✅ File reconstructed: ${transfer.fileName}`)
      this.onFileReceived?.(deviceId, receivedFile)
      this.fileTransfers.delete(deviceId)
    } catch (error) {
      console.error('❌ Failed to reconstruct file:', error)
      this.fileTransfers.delete(deviceId)
    }
  }
}
