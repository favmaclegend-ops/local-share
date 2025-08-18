'use client'

import { useState, useRef } from 'react'

type Device = { id: string; name: string; status: 'online' | 'offline' }

export default function Page() {
  const [devices] = useState<Device[]>([
    { id: 'demo-1', name: 'My Laptop', status: 'online' },
    { id: 'demo-2', name: 'Pixel 7', status: 'offline' },
  ])

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const onPickFiles = () => fileInputRef.current?.click()
  const onFilesChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    console.log('Selected files:', files.map(f => `${f.name} (${f.size}B)`))
  }

  return (
    <div className="mx-auto  p-6 min-h-screen bg-slate-950 text-white">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">LocalShare</h1>
        <div className="flex gap-2">
          <button
            onClick={onPickFiles}
            className="rounded-lg px-4 py-2 bg-sky-500 hover:bg-sky-600 text-white"
          >
            Send Files
          </button>
          <button
            onClick={() => alert('Receive flow coming soon')}
            className="rounded-lg px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white"
          >
            Receive
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onFilesChosen}
          />
        </div>
      </header>

      <section className="mt-6 rounded-xl border border-gray-800 bg-gray-900">
        <div className="flex items-center justify-between p-4">
          <h2 className="text-lg font-medium">Available Devices</h2>
          <button
            className="rounded px-3 py-1 bg-gray-800 hover:bg-gray-700 text-sm"
            onClick={() => alert('Discovery runs Day 2')}
          >
            Refresh
          </button>
        </div>
        <div className="divide-y divide-gray-800">
          {devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between p-4">
              <div>
                <div className="font-medium">{d.name}</div>
                <div className="text-xs text-gray-400">ID: {d.id}</div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                    d.status === 'online'
                      ? 'bg-green-600/20 text-green-400'
                      : 'bg-gray-700 text-gray-400'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      d.status === 'online' ? 'bg-green-400' : 'bg-gray-400'
                    }`}
                  />
                  {d.status}
                </span>
                <button
                  className="rounded px-3 py-1 text-sm bg-sky-500 hover:bg-sky-600 text-white"
                  disabled={d.status !== 'online'}
                  onClick={() => alert('Connect flow coming Day 3')}
                >
                  Connect
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-10 text-center text-xs text-gray-500">
        Same Wi-Fi · Local only · Files never leave your network
      </footer>
    </div>
  )
}
