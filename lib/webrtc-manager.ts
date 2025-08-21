export interface WebRTCConfig {
  iceServers: RTCIceServer[]
}

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate'
  data: any
  targetDeviceId: string
  sourceDeviceId: string
}

export interface ConnectionEventHandlers {
  onConnectionStateChange: (state: RTCPeerConnectionState) => void
  onDataChannelOpen: () => void
  onDataChannelMessage: (event: MessageEvent) => void
  onDataChannelError: (error: Event) => void
  onIceCandidate: (candidate: RTCIceCandidate | null) => void
}

export class WebRTCManager {
  private peerConnection: RTCPeerConnection | null = null
  private dataChannel: RTCDataChannel | null = null
  private config: WebRTCConfig
  private deviceId: string
  private handlers: Partial<ConnectionEventHandlers> = {}

  // Default STUN servers for NAT traversal
  private static defaultConfig: WebRTCConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ]
  }

  constructor(deviceId: string, config: WebRTCConfig = WebRTCManager.defaultConfig) {
    this.deviceId = deviceId
    this.config = config
  }

  public setEventHandlers(handlers: Partial<ConnectionEventHandlers>) {
    this.handlers = { ...this.handlers, ...handlers }
  }

  public async createOffer(targetDeviceId: string): Promise<SignalingMessage> {
    console.log(`📞 Creating WebRTC offer for device: ${targetDeviceId}`)
    this.initializePeerConnection()
    this.createDataChannel()

    const offer = await this.peerConnection!.createOffer()
    await this.peerConnection!.setLocalDescription(offer)
    
    console.log('📤 WebRTC offer created and set as local description')

    return {
      type: 'offer',
      data: offer,
      targetDeviceId,
      sourceDeviceId: this.deviceId
    }
  }

  public async handleOffer(message: SignalingMessage): Promise<SignalingMessage> {
    console.log(`📞 Received WebRTC offer from device: ${message.sourceDeviceId}`)
    this.initializePeerConnection()

    await this.peerConnection!.setRemoteDescription(message.data)
    console.log('📥 Remote offer set as remote description')
    
    const answer = await this.peerConnection!.createAnswer()
    await this.peerConnection!.setLocalDescription(answer)
    console.log('📤 WebRTC answer created and set as local description')

    return {
      type: 'answer',
      data: answer,
      targetDeviceId: message.sourceDeviceId,
      sourceDeviceId: this.deviceId
    }
  }

  public async handleAnswer(message: SignalingMessage): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('No peer connection available')
    }
    
    console.log(`📞 Received WebRTC answer from device: ${message.sourceDeviceId}`)
    await this.peerConnection.setRemoteDescription(message.data)
    console.log('📥 Remote answer set as remote description')
  }

  public async handleIceCandidate(message: SignalingMessage): Promise<void> {
    if (!this.peerConnection) {
      throw new Error('No peer connection available')
    }

    if (message.data) {
      await this.peerConnection.addIceCandidate(message.data)
    }
  }

  public sendMessage(message: any): boolean {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      console.warn('Data channel not open, cannot send message')
      return false
    }

    try {
      this.dataChannel.send(JSON.stringify(message))
      return true
    } catch (error) {
      console.error('Failed to send message:', error)
      return false
    }
  }

  public sendFile(file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
        reject(new Error('Data channel not open'))
        return
      }

      console.log(`📤 Starting file transfer: ${file.name}`)
      console.log(`📄 File size: ${file.size} bytes (${(file.size / 1024 / 1024).toFixed(2)} MB)`)
      console.log(`📝 MIME type: ${file.type}`)

      const CHUNK_SIZE = 16384 // 16KB chunks
      const reader = new FileReader()
      let offset = 0
      const startTime = Date.now()

      // Send file metadata first
      this.sendMessage({
        type: 'file-start',
        name: file.name,
        size: file.size,
        mimeType: file.type
      })
      
      console.log('📡 File metadata sent')

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
          this.dataChannel!.send(event.target.result as ArrayBuffer)
          offset += CHUNK_SIZE
          
          const progress = (offset / file.size) * 100
          console.log(`📦 Sent chunk: ${(event.target.result as ArrayBuffer).byteLength} bytes (${progress.toFixed(1)}% complete)`)

          if (offset < file.size) {
            sendChunk() // Send next chunk
          } else {
            // File transfer complete
            const endTime = Date.now()
            const duration = (endTime - startTime) / 1000
            const speed = (file.size / 1024 / duration).toFixed(2)
            
            console.log('📡 Sending file-end signal')
            this.sendMessage({ type: 'file-end' })
            
            console.log(`✅ File transfer completed successfully!`)
            console.log(`⏱️ Duration: ${duration.toFixed(2)} seconds`)
            console.log(`🚀 Average speed: ${speed} KB/s`)
            
            resolve()
          }
        } catch (error) {
          console.error('❌ Failed to send chunk:', error)
          reject(error)
        }
      }

      reader.onerror = () => {
        console.error('❌ Failed to read file')
        reject(new Error('Failed to read file'))
      }

      sendChunk() // Start sending
    })
  }

  public getConnectionState(): RTCPeerConnectionState | null {
    return this.peerConnection?.connectionState || null
  }

  public getDataChannelState(): RTCDataChannelState | null {
    return this.dataChannel?.readyState || null
  }

  public isConnected(): boolean {
    return this.peerConnection?.connectionState === 'connected' &&
           this.dataChannel?.readyState === 'open'
  }

  public close(): void {
    if (this.dataChannel) {
      this.dataChannel.close()
      this.dataChannel = null
    }

    if (this.peerConnection) {
      this.peerConnection.close()
      this.peerConnection = null
    }
  }

  private initializePeerConnection(): void {
    if (this.peerConnection) {
      return // Already initialized
    }

    this.peerConnection = new RTCPeerConnection(this.config)

    // Set up event handlers
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection!.connectionState
      console.log(`🔄 WebRTC Peer Connection State: ${state}`)
      
      if (state === 'connected') {
        console.log('✅ WebRTC Peer Connection ESTABLISHED!')
        console.log('🌐 Direct P2P connection active')
      } else if (state === 'connecting') {
        console.log('⏳ WebRTC connection in progress...')
      } else if (state === 'failed') {
        console.log('❌ WebRTC connection failed')
      }
      
      this.handlers.onConnectionStateChange?.(state)
    }

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('🧊 ICE Candidate Generated:', event.candidate.type, event.candidate.address || 'N/A')
      } else {
        console.log('🧊 ICE Candidate gathering complete')
      }
      this.handlers.onIceCandidate?.(event.candidate)
    }

    this.peerConnection.ondatachannel = (event) => {
      const channel = event.channel
      this.setupDataChannelHandlers(channel)
      this.dataChannel = channel
    }
  }

  private createDataChannel(): void {
    if (!this.peerConnection) {
      throw new Error('Peer connection not initialized')
    }

    this.dataChannel = this.peerConnection.createDataChannel('fileTransfer', {
      ordered: true // Ensure reliable, ordered delivery
    })

    this.setupDataChannelHandlers(this.dataChannel)
  }

  private setupDataChannelHandlers(channel: RTCDataChannel): void {
    channel.onopen = () => {
      console.log('🎉 SUCCESS: WebRTC Data Channel OPENED!')
      console.log('📡 Peer-to-peer connection established successfully')
      console.log('🔗 Ready for direct file transfer between devices')
      console.log('Channel state:', channel.readyState)
      console.log('Peer connection state:', this.peerConnection?.connectionState)
      this.handlers.onDataChannelOpen?.()
    }

    channel.onmessage = (event) => {
      console.log('📨 Data channel message received:', event.data)
      this.handlers.onDataChannelMessage?.(event)
    }

    channel.onerror = (error) => {
      console.error('❌ Data channel error:', error)
      this.handlers.onDataChannelError?.(error)
    }

    channel.onclose = () => {
      console.log('🔌 Data channel closed')
    }
  }
}
