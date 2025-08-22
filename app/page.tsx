'use client'

import { useState, useRef, useEffect } from 'react'
import { sendFile, receiveFile, triggerDownload, FileProgress } from '@/lib/fileTransfer';

// Simple inline implementation to avoid module issues
interface Device {
  id: string
  name: string
  status: 'online' | 'offline'
}

interface ReceivedFile {
  name: string
  size: number
  blob: Blob
  url: string
  receivedAt: Date
}

interface FileTransferProgress {
  fileName: string
  progress: number
  receivedSize: number
  totalSize: number
}

export default function Page() {
  // State management
  const [isConnected, setIsConnected] = useState(false)
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [deviceName, setDeviceName] = useState('My Device')
  const [devices, setDevices] = useState<Device[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [receivedFiles, setReceivedFiles] = useState<ReceivedFile[]>([])
  const [fileTransferProgress, setFileTransferProgress] = useState<FileTransferProgress | null>(null)
  const [connections, setConnections] = useState<Map<string, any>>(new Map())
  const [socket, setSocket] = useState<any>(null)
  const [fileTransfers, setFileTransfers] = useState<Map<string, any>>(new Map())
  
  // Initialize networking
  const initNetworking = async () => {
    if (typeof window === 'undefined') return
    
    try {
      setIsLoading(true)
      
      // Dynamic import to avoid SSR issues
      const { io } = await import('socket.io-client')
      
      const socketInstance = io('http://localhost:3000', {
        transports: ['websocket', 'polling']
      })
      
      socketInstance.on('connect', () => {
        console.log('🌐 Connected to signaling server')
        setIsConnected(true)
        setIsLoading(false)
        
        // Register device
        socketInstance.emit('register-device', { name: deviceName })
      })
      
      socketInstance.on('device-registered', (data: any) => {
        setDeviceId(data.deviceId)
        console.log(`📱 Device registered: ${data.name}`)
      })
      
      socketInstance.on('devices-updated', (deviceList: Device[]) => {
        console.log('📋 Devices updated:', deviceList.length)
        setDevices(deviceList.filter(d => d.id !== deviceId))
      })
      
      socketInstance.on('webrtc-signal', async (message: any) => {
        await handleWebRTCSignal(message, socketInstance)
      })
      
      socketInstance.on('connect_error', (err: any) => {
        console.error('❌ Connection error:', err)
        setError('Failed to connect to server')
        setIsLoading(false)
      })
      
      setSocket(socketInstance)
      
    } catch (err) {
      console.error('❌ Failed to initialize networking:', err)
      setError('Failed to initialize networking')
      setIsLoading(false)
    }
  }
  
  // WebRTC signal handling
  const handleWebRTCSignal = async (message: any, socketInstance: any) => {
    try {
      switch (message.type) {
        case 'offer':
          await handleOffer(message, socketInstance)
          break
        case 'answer':
          await handleAnswer(message)
          break
        case 'ice-candidate':
          await handleIceCandidate(message)
          break
      }
    } catch (err) {
      console.error('❌ WebRTC signaling error:', err)
    }
  }
  
  const handleOffer = async (message: any, socketInstance: any) => {
    console.log(`📞 Received offer from ${message.sourceDeviceId}`)
    
    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    })
    
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        socketInstance.emit('webrtc-signal', {
          type: 'ice-candidate',
          data: event.candidate,
          targetDeviceId: message.sourceDeviceId,
          sourceDeviceId: deviceId
        })
      }
    }
    
    peerConnection.ondatachannel = (event) => {
      setupDataChannelHandlers(event.channel, message.sourceDeviceId)
      setConnections(prev => new Map(prev.set(message.sourceDeviceId, {
        peerConnection,
        dataChannel: event.channel
      })))
    }
    
    await peerConnection.setRemoteDescription(message.data)
    const answer = await peerConnection.createAnswer()
    await peerConnection.setLocalDescription(answer)
    
    socketInstance.emit('webrtc-signal', {
      type: 'answer',
      data: answer,
      targetDeviceId: message.sourceDeviceId,
      sourceDeviceId: deviceId
    })
  }
  
  const handleAnswer = async (message: any) => {
    const connection = connections.get(message.sourceDeviceId)
    if (connection?.peerConnection) {
      await connection.peerConnection.setRemoteDescription(message.data)
    }
  }
  
  const handleIceCandidate = async (message: any) => {
    const connection = connections.get(message.sourceDeviceId)
    if (connection?.peerConnection && message.data) {
      await connection.peerConnection.addIceCandidate(message.data)
    }
  }
  
  // Setup data channel handlers
    const setupDataChannelHandlers = (dc: RTCDataChannel, remoteId: string) => {
        dc.onopen = () => console.log(`🎉 Data channel opened with ${remoteId}`);

        receiveFile(dc, (p) => setFileTransferProgress(p)).then(({ blob, meta }) => {
            const url = URL.createObjectURL(blob);
            setReceivedFiles((prev) => [
                ...prev,
                { name: meta.name, size: meta.size, blob, url, receivedAt: new Date() },
            ]);
            setFileTransferProgress(null);
            triggerDownload(blob, meta.name); // auto-download
        });
    };
  
  // Handle incoming messages/files
  const handleDataChannelMessage = (deviceId: string, event: MessageEvent) => {
    try {
      if (typeof event.data === 'string') {
        const message = JSON.parse(event.data)
        
        switch (message.type) {
          case 'file-start':
            console.log(`📥 File transfer started: ${message.name}`)
            setFileTransfers(prev => new Map(prev.set(deviceId, {
              fileName: message.name,
              totalSize: message.size,
              mimeType: message.mimeType,
              chunks: [],
              receivedSize: 0
            })))
            
            setFileTransferProgress({
              fileName: message.name,
              progress: 0,
              receivedSize: 0,
              totalSize: message.size
            })
            break
            
          case 'file-end':
            reconstructFile(deviceId)
            break
        }
      } else if (event.data instanceof ArrayBuffer) {
        handleFileChunk(deviceId, event.data)
      }
    } catch (err) {
      console.error('❌ Failed to handle data channel message:', err)
    }
  }
  
  const handleFileChunk = (deviceId: string, chunk: ArrayBuffer) => {
    setFileTransfers(prev => {
      const transfer = prev.get(deviceId)
      if (!transfer) return prev
      
      const newTransfer = {
        ...transfer,
        chunks: [...transfer.chunks, chunk],
        receivedSize: transfer.receivedSize + chunk.byteLength
      }
      
      const progress = (newTransfer.receivedSize / newTransfer.totalSize) * 100
      
      setFileTransferProgress({
        fileName: newTransfer.fileName,
        progress,
        receivedSize: newTransfer.receivedSize,
        totalSize: newTransfer.totalSize
      })
      
      return new Map(prev.set(deviceId, newTransfer))
    })
  }
  
  const reconstructFile = (deviceId: string) => {
    const transfer = fileTransfers.get(deviceId)
    if (!transfer) return
    
    try {
      const blob = new Blob(transfer.chunks, { type: transfer.mimeType })
      const url = URL.createObjectURL(blob)
      
      const receivedFile: ReceivedFile = {
        name: transfer.fileName,
        size: transfer.totalSize,
        blob,
        url,
        receivedAt: new Date()
      }
      
      console.log(`✅ File reconstructed: ${transfer.fileName}`)
      setReceivedFiles(prev => [...prev, receivedFile])
      setFileTransferProgress(null)
      setFileTransfers(prev => {
        const newMap = new Map(prev)
        newMap.delete(deviceId)
        return newMap
      })
    } catch (err) {
      console.error('❌ Failed to reconstruct file:', err)
    }
  }
  
  // Connect to device
  const connectToDevice = async (targetDeviceId: string) => {
    if (!socket || !deviceId) return
    
    console.log(`🔗 Connecting to device: ${targetDeviceId}`)
    
    try {
      const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      })
      
      const dataChannel = peerConnection.createDataChannel('fileTransfer', { ordered: true })
      setupDataChannelHandlers(dataChannel, targetDeviceId)
      
      setConnections(prev => new Map(prev.set(targetDeviceId, {
        peerConnection,
        dataChannel
      })))
      
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc-signal', {
            type: 'ice-candidate',
            data: event.candidate,
            targetDeviceId,
            sourceDeviceId: deviceId
          })
        }
      }
      
      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)
      
      socket.emit('webrtc-signal', {
        type: 'offer',
        data: offer,
        targetDeviceId,
        sourceDeviceId: deviceId
      })
      
    } catch (err) {
      console.error('❌ Failed to connect to device:', err)
      setError('Failed to connect to device')
    }
  }
  
  // Send file
  const sendFileToDevice = async (targetDeviceId: string, file: File) => {
    const connection = connections.get(targetDeviceId)
    if (!connection?.dataChannel || connection.dataChannel.readyState !== 'open') {
      throw new Error('No active connection to device')
    }
    
    console.log(`📤 Starting file transfer: ${file.name}`)
    
    const CHUNK_SIZE = 16384
    const reader = new FileReader()
    let offset = 0
    
    // Send metadata
    connection.dataChannel.send(JSON.stringify({
      type: 'file-start',
      name: file.name,
      size: file.size,
      mimeType: file.type
    }))
    
    return new Promise<void>((resolve, reject) => {
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
          
          if (offset < file.size) {
            sendChunk()
          } else {
            connection.dataChannel.send(JSON.stringify({ type: 'file-end' }))
            console.log('✅ File transfer completed!')
            resolve()
          }
        } catch (err) {
          reject(err)
        }
      }
      
      reader.onerror = () => reject(new Error('Failed to read file'))
      sendChunk()
    })
  }
  
  const downloadFile = (file: ReceivedFile) => {
    const a = document.createElement('a')
    a.href = file.url
    a.download = file.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
  
  const clearReceivedFiles = () => {
    receivedFiles.forEach(file => URL.revokeObjectURL(file.url))
    setReceivedFiles([])
  }
  
  const isDeviceConnected = (deviceId: string) => {
    const connection = connections.get(deviceId)
    return connection?.dataChannel?.readyState === 'open'
  }

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [sendingTo, setSendingTo] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [newName, setNewName] = useState(deviceName)

  // Auto-connect when component mounts
  useEffect(() => {
    if (!isConnected && !isLoading) {
      initNetworking()
    }
  }, [])

  // Update device name
  useEffect(() => {
    setNewName(deviceName)
  }, [deviceName])

  const onPickFiles = () => fileInputRef.current?.click()
  
  const onFilesChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    setSelectedFiles(files)
    console.log('Selected files:', files.map(f => `${f.name} (${f.size}B)`))
  }

  const handleConnect = async (deviceId: string) => {
    try {
      await connectToDevice(deviceId)
    } catch (error) {
      console.error('Failed to connect:', error)
    }
  }

  const handleSendFile = async (targetDeviceId: string, file: File) => {
    try {
      setSendingTo(targetDeviceId)
      await sendFileToDevice(targetDeviceId, file)
      console.log(`File sent successfully to ${targetDeviceId}`)
    } catch (error) {
      console.error('Failed to send file:', error)
    } finally {
      setSendingTo(null)
    }
  }

    const handleSendFiles = async (targetDeviceId: string) => {
        const conn = connections.get(targetDeviceId);
        if (!conn?.dataChannel || conn.dataChannel.readyState !== 'open')
            return alert('No open data-channel');

        const file = selectedFiles[0];
        if (!file) return onPickFiles(); // open file picker first

        setSendingTo(targetDeviceId);
        try {
            await sendFile(file, conn.dataChannel, (sent) =>
                setFileTransferProgress({
                    fileName: file.name,
                    progress: (sent / file.size) * 100,
                    receivedSize: sent,
                    totalSize: file.size,
                })
            );
        } finally {
            setSendingTo(null);
            setSelectedFiles([]);
        }
    };
  const handleSendTestMessage = async (targetDeviceId: string) => {
    try {
      // Get the WebRTC connection from our networking hook
      const testMessage = {
        type: 'test-message',
        timestamp: Date.now(),
        message: '🎉 Hello from WebRTC! P2P connection is working!'
      }
      
      console.log('🚀 Sending test message via WebRTC data channel...')
      // This would use the sendMessage method from WebRTC manager
      // For now, we'll simulate it since we need to access the connection directly
      console.log('📤 Test message:', testMessage)
      
      // In a real implementation, you'd access the WebRTC manager through the networking context
      alert('Check the console for WebRTC connection logs!')
    } catch (error) {
      console.error('Failed to send test message:', error)
    }
  }

  const disconnect = () => {
    if (socket) {
      socket.disconnect()
      setSocket(null)
    }
    setIsConnected(false)
    setConnections(new Map())
    setFileTransfers(new Map())
  }
  
  const clearError = () => {
    setError(null)
  }

  const handleSaveName = () => {
    setDeviceName(newName)
    setEditingName(false)
  }

  const handleCancelEdit = () => {
    setNewName(deviceName)
    setEditingName(false)
  }

  return (
    <div className="mx-auto p-6 min-h-screen bg-slate-950 text-white">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">LocalShare</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-gray-400">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white text-xs"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveName()
                    if (e.key === 'Escape') handleCancelEdit()
                  }}
                  autoFocus
                />
                <button
                  onClick={handleSaveName}
                  className="text-green-400 hover:text-green-300"
                >
                  ✓
                </button>
                <button
                  onClick={handleCancelEdit}
                  className="text-red-400 hover:text-red-300"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => setEditingName(true)}
                className="hover:text-white cursor-pointer"
              >
                {deviceName} ✎
              </button>
            )}
            {deviceId && (
              <span className="text-xs text-gray-500">ID: {deviceId.slice(0, 8)}...</span>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {!isConnected ? (
            <button
              onClick={initNetworking}
              disabled={isLoading}
              className="rounded-lg px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Connecting...' : 'Connect to Network'}
            </button>
          ) : (
            <>
              <button
                onClick={onPickFiles}
                className="rounded-lg px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white"
              >
                Select Files
              </button>
              <button
                onClick={disconnect}
                className="rounded-lg px-4 py-2 bg-red-600 hover:bg-red-700 text-white"
              >
                Disconnect
              </button>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onFilesChosen}
          />
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3 bg-red-600/20 border border-red-600/30 rounded-lg text-red-300">
          <div className="flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={clearError}
              className="text-red-300 hover:text-red-200"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {selectedFiles.length > 0 && (
        <div className="mb-4 p-3 bg-blue-600/20 border border-blue-600/30 rounded-lg">
          <div className="text-sm font-medium text-blue-300 mb-2">Selected Files:</div>
          <div className="text-xs text-blue-200">
            {selectedFiles.map(file => `${file.name} (${(file.size / 1024).toFixed(1)} KB)`).join(', ')}
          </div>
          <button
            onClick={() => setSelectedFiles([])}
            className="mt-2 text-xs text-blue-300 hover:text-blue-200"
          >
            Clear Selection
          </button>
        </div>
      )}

      {fileTransferProgress && (
        <div className="mb-4 p-3 bg-purple-600/20 border border-purple-600/30 rounded-lg">
          <div className="text-sm font-medium text-purple-300 mb-2">
            📤 Receiving: {fileTransferProgress.fileName}
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
            <div 
              className="bg-purple-500 h-2 rounded-full transition-all duration-300" 
              style={{ width: `${fileTransferProgress.progress}%` }}
            />
          </div>
          <div className="text-xs text-purple-200">
            {(fileTransferProgress.receivedSize / 1024).toFixed(1)} KB / {(fileTransferProgress.totalSize / 1024).toFixed(1)} KB 
            ({fileTransferProgress.progress.toFixed(1)}%)
          </div>
        </div>
      )}

      {receivedFiles.length > 0 && (
        <div className="mb-4 p-3 bg-green-600/20 border border-green-600/30 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-green-300">📥 Received Files ({receivedFiles.length})</div>
            <button
              onClick={clearReceivedFiles}
              className="text-xs text-green-300 hover:text-green-200"
            >
              Clear All
            </button>
          </div>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {receivedFiles.map((file, index) => (
              <div key={index} className="flex items-center justify-between bg-green-600/10 rounded p-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-green-200 truncate">{file.name}</div>
                  <div className="text-xs text-green-400">
                    {(file.size / 1024).toFixed(1)} KB • {file.receivedAt.toLocaleTimeString()}
                  </div>
                </div>
                <button
                  onClick={() => downloadFile(file)}
                  className="ml-2 px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded"
                >
                  💾 Download
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <section className="rounded-xl border border-gray-800 bg-gray-900">
        <div className="flex items-center justify-between p-4">
          <h2 className="text-lg font-medium">Available Devices</h2>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
              isConnected
                ? 'bg-green-600/20 text-green-400'
                : 'bg-gray-700 text-gray-400'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${
                isConnected ? 'bg-green-400' : 'bg-gray-400'
              }`} />
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
            <button
              className="rounded px-3 py-1 bg-gray-800 hover:bg-gray-700 text-sm disabled:opacity-50"
              onClick={() => console.log('Refresh devices')}
              disabled={!isConnected}
            >
              Refresh
            </button>
          </div>
        </div>
        
        <div className="divide-y divide-gray-800">
          {devices.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              {!isConnected ? (
                'Connect to the network to discover devices'
              ) : (
                'No other devices found on the network'
              )}
            </div>
          ) : (
            devices.map((device) => {
              const connected = isDeviceConnected(device.id)
              const sending = sendingTo === device.id
              
              return (
                <div key={device.id} className="flex items-center justify-between p-4">
                  <div>
                    <div className="font-medium">{device.name}</div>
                    <div className="text-xs text-gray-400">ID: {device.id.slice(0, 8)}...</div>
                    {connected && (
                      <div className="text-xs text-blue-400 mt-1">
                        Connection: connected
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                      device.status === 'online'
                        ? 'bg-green-600/20 text-green-400'
                        : 'bg-gray-700 text-gray-400'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${
                        device.status === 'online' ? 'bg-green-400' : 'bg-gray-400'
                      }`} />
                      {device.status}
                    </span>
                    
                    {!connected ? (
                      <button
                        className="rounded px-3 py-1 text-sm bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={device.status !== 'online'}
                        onClick={() => handleConnect(device.id)}
                      >
                        Connect
                      </button>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          className="rounded px-2 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white"
                          onClick={() => handleSendTestMessage(device.id)}
                        >
                          Test P2P
                        </button>
                        <button
                          className="rounded px-3 py-1 text-sm bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                          disabled={sending}
                          onClick={() => handleSendFiles(device.id)}
                        >
                          {sending ? 'Sending...' : selectedFiles.length > 0 ? 'Send Files' : 'Select Files'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      <footer className="mt-10 text-center text-xs text-gray-500">
        Same Wi-Fi · Local only · Files never leave your network
      </footer>
    </div>
  )
}
