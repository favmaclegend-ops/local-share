const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const { Server } = require('socket.io')
const { v4: uuidv4 } = require('uuid')

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = parseInt(process.env.PORT || '3000', 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

class SignalingServer {
  constructor(io) {
    this.io = io
    this.devices = new Map()
    this.setupEventHandlers()
    this.startCleanupTimer()
  }

  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`)

      socket.on('register-device', (deviceInfo) => {
        const deviceId = uuidv4()
        const device = {
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

      socket.on('webrtc-signal', (message) => {
        console.log(`WebRTC signal: ${message.type} from ${message.sourceDeviceId} to ${message.targetDeviceId}`)
        
        // Forward the signaling message to the target device
        const targetDevice = this.devices.get(message.targetDeviceId)
        if (targetDevice) {
          this.io.to(targetDevice.socketId).emit('webrtc-signal', message)
        } else {
          socket.emit('error', { message: 'Target device not found' })
        }
      })

      socket.on('heartbeat', (deviceId) => {
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

  sendDeviceList(socket) {
    const deviceList = Array.from(this.devices.values()).map(device => ({
      id: device.id,
      name: device.name,
      status: this.isDeviceOnline(device) ? 'online' : 'offline'
    }))

    socket.emit('devices-updated', deviceList)
  }

  broadcastDeviceList() {
    const deviceList = Array.from(this.devices.values()).map(device => ({
      id: device.id,
      name: device.name,
      status: this.isDeviceOnline(device) ? 'online' : 'offline'
    }))

    this.io.emit('devices-updated', deviceList)
  }

  isDeviceOnline(device) {
    const TIMEOUT = 30000 // 30 seconds
    return Date.now() - device.lastSeen < TIMEOUT
  }

  startCleanupTimer() {
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

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  })

  const io = new Server(server, {
    cors: {
      origin: dev ? '*' : false,
      methods: ['GET', 'POST']
    }
  })

  // Initialize signaling server
  new SignalingServer(io)

  server.listen(port, (err) => {
    if (err) throw err
    console.log(`> Ready on http://${hostname}:${port}`)
    console.log(`> Socket.IO server running on port ${port}`)
  })
})

