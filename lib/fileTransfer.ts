// lib/fileTransfer.ts
const CHUNK_SIZE = 16 * 1024; // 16 KB

export interface FileMeta {
    name: string;
    size: number;
    mimeType: string;
}

export interface FileProgress {
    fileName: string;
    progress: number;
    receivedSize: number;
    totalSize: number;
}

/* ---------- SENDER ---------- */
export async function sendFile(
    file: File,
    dc: RTCDataChannel,
    onProgress?: (sent: number) => void
): Promise<void> {
    if (dc.readyState !== 'open') throw new Error('Data channel not open');

    const meta: FileMeta = { name: file.name, size: file.size, mimeType: file.type };
    dc.send(JSON.stringify({ type: 'file-meta', meta }));

    const stream = file.stream().getReader();
    let offset = 0;
    while (true) {
        const { done, value } = await stream.read();
        if (done) break;
        dc.send(value);
        offset += value.byteLength;
        onProgress?.(offset);
    }
    dc.send(JSON.stringify({ type: 'file-done' }));
}

/* ---------- RECEIVER ---------- */
export function receiveFile(
    dc: RTCDataChannel,
    onProgress?: (p: FileProgress) => void
): Promise<{ blob: Blob; meta: FileMeta }> {
    return new Promise((resolve) => {
        let meta: FileMeta | null = null;
        const chunks: Uint8Array[] = [];

        dc.onmessage = (ev) => {
            if (typeof ev.data === 'string') {
                const msg = JSON.parse(ev.data);

                if (msg.type === 'file-meta') {
                    meta = msg.meta;
                } else if (msg.type === 'file-done' && meta) {
                    const blob = new Blob(chunks, { type: meta.mimeType });
                    resolve({ blob, meta });
                }
            } else {
                chunks.push(new Uint8Array(ev.data));
                if (meta) {
                    const received = chunks.reduce((a, c) => a + c.byteLength, 0);
                    onProgress?.({
                        fileName: meta.name,
                        progress: (received / meta.size) * 100,
                        receivedSize: received,
                        totalSize: meta.size,
                    });
                }
            }
        };
    });
}

/* ---------- UTIL ---------- */
export function triggerDownload(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
        href: url,
        download: fileName,
    });
    a.click();
    URL.revokeObjectURL(url);
}