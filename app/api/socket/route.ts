import { NextRequest } from 'next/server'
import { Server } from 'socket.io'
import { v4 as uuidv4 } from 'uuid'

interface Device {
  id: string
  name: string
  socketId: string
  lastSeen: number
}

interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate'
  data: any
  targetDeviceId: string
  sourceDeviceId: string
}

class SignalingServer {
  private io: Server
  private devices: Map<string, Device> = new Map()

  constructor(server: any) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.NODE_ENV === 'development' ? '*' : false,
        methods: ['GET', 'POST']
      }
    })

    this.setupEventHandlers()
    this.startCleanupTimer()
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`)

      socket.on('register-device', (deviceInfo: { name: string }) => {
        const deviceId = uuidv4()
        const device: Device = {
          id: deviceId,
          name: deviceInfo.name || `Device-${deviceId.slice(0, 8)}`,
          socketId: socket.id,
          lastSeen: Date.now()
        }

        this.devices.set(deviceId, device)
        socket.join(`device-${deviceId}`)

        console.log(`Device registered: ${device.name} (${deviceId})`)

        // Send the device ID back to the client
        socket.emit('device-registered', { deviceId, name: device.name })

        // Broadcast updated device list
        this.broadcastDeviceList()
      })

      socket.on('get-devices', () => {
        this.sendDeviceList(socket)
      })

      socket.on('webrtc-signal', (message: SignalingMessage) => {
        console.log(`WebRTC signal: ${message.type} from ${message.sourceDeviceId} to ${message.targetDeviceId}`)
        
        // Forward the signaling message to the target device
        const targetDevice = this.devices.get(message.targetDeviceId)
        if (targetDevice) {
          this.io.to(targetDevice.socketId).emit('webrtc-signal', message)
        } else {
          socket.emit('error', { message: 'Target device not found' })
        }
      })

      socket.on('heartbeat', (deviceId: string) => {
        const device = this.devices.get(deviceId)
        if (device) {
          device.lastSeen = Date.now()
        }
      })

      socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`)
        
        // Remove the device from our list
        for (const [deviceId, device] of this.devices.entries()) {
          if (device.socketId === socket.id) {
            this.devices.delete(deviceId)
            console.log(`Device removed: ${device.name} (${deviceId})`)
            break
          }
        }

        // Broadcast updated device list
        this.broadcastDeviceList()
      })
    })
  }

  private sendDeviceList(socket: any) {
    const deviceList = Array.from(this.devices.values()).map(device => ({
      id: device.id,
      name: device.name,
      status: this.isDeviceOnline(device) ? 'online' : 'offline'
    }))

    socket.emit('devices-updated', deviceList)
  }

  private broadcastDeviceList() {
    const deviceList = Array.from(this.devices.values()).map(device => ({
      id: device.id,
      name: device.name,
      status: this.isDeviceOnline(device) ? 'online' : 'offline'
    }))

    this.io.emit('devices-updated', deviceList)
  }

  private isDeviceOnline(device: Device): boolean {
    const TIMEOUT = 30000 // 30 seconds
    return Date.now() - device.lastSeen < TIMEOUT
  }

  private startCleanupTimer() {
    setInterval(() => {
      const TIMEOUT = 60000 // 1 minute
      const now = Date.now()
      let devicesRemoved = false

      for (const [deviceId, device] of this.devices.entries()) {
        if (now - device.lastSeen > TIMEOUT) {
          this.devices.delete(deviceId)
          console.log(`Device timed out: ${device.name} (${deviceId})`)
          devicesRemoved = true
        }
      }

      if (devicesRemoved) {
        this.broadcastDeviceList()
      }
    }, 30000) // Check every 30 seconds
  }
}

let signalingServer: SignalingServer | null = null

export async function GET(request: NextRequest) {
  if (!signalingServer) {
    // This is a placeholder - in a real Next.js app, you'd need to set up Socket.IO differently
    // For now, we'll return a message indicating the signaling server endpoint
    return Response.json({ 
      message: 'Signaling server endpoint - WebSocket upgrade required',
      endpoint: '/api/socket'
    })
  }

  return Response.json({ message: 'Signaling server running' })
}
