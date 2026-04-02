export interface ZipReadEntry {
  name: string;
  data: Uint8Array;
}

const MAX_ZIP_ENTRY_COUNT = 500;
const MAX_ZIP_TOTAL_BYTES = 16 * 1024 * 1024;

function readUInt16LE(input: Uint8Array, offset: number): number {
  return input[offset]! | (input[offset + 1]! << 8);
}

function readUInt32LE(input: Uint8Array, offset: number): number {
  return (
    input[offset]! |
    (input[offset + 1]! << 8) |
    (input[offset + 2]! << 16) |
    (input[offset + 3]! << 24)
  ) >>> 0;
}

/**
 * Minimal ZIP reader for locally generated uncompressed archives.
 * It iterates local file headers and reads stored entries.
 */
export function readStoredZipEntries(archive: Uint8Array): ZipReadEntry[] {
  const entries: ZipReadEntry[] = [];
  const headerSignature = 0x04034b50;
  let cursor = 0;
  let totalBytes = 0;

  while (cursor + 30 <= archive.length) {
    if (entries.length >= MAX_ZIP_ENTRY_COUNT) {
      throw new Error(`UDF arsivi cok fazla dosya iceriyor (>${MAX_ZIP_ENTRY_COUNT}).`);
    }

    const signature = readUInt32LE(archive, cursor);
    if (signature !== headerSignature) {
      break;
    }

    const compressionMethod = readUInt16LE(archive, cursor + 8);
    if (compressionMethod !== 0) {
      throw new Error(`Unsupported compression method: ${compressionMethod}`);
    }

    const compressedSize = readUInt32LE(archive, cursor + 18);
    const uncompressedSize = readUInt32LE(archive, cursor + 22);
    const fileNameLength = readUInt16LE(archive, cursor + 26);
    const extraFieldLength = readUInt16LE(archive, cursor + 28);

    const fileNameStart = cursor + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    const dataStart = fileNameEnd + extraFieldLength;
    const dataEnd = dataStart + compressedSize;

    if (fileNameEnd > archive.length || dataStart > archive.length) {
      throw new Error("Corrupted ZIP: invalid file header offsets");
    }

    if (dataEnd > archive.length) {
      throw new Error("Corrupted ZIP: entry data exceeds archive length");
    }

    const name = new TextDecoder().decode(archive.slice(fileNameStart, fileNameEnd));
    const data = archive.slice(dataStart, dataEnd);

    if (compressedSize !== uncompressedSize) {
      throw new Error(`Compressed size mismatch for ${name}`);
    }

    totalBytes += uncompressedSize;
    if (totalBytes > MAX_ZIP_TOTAL_BYTES) {
      throw new Error(`UDF arsivi cok buyuk (>${MAX_ZIP_TOTAL_BYTES} byte).`);
    }

    entries.push({ name, data });
    cursor = dataEnd;
  }

  return entries;
}

export function readStoredZipEntryMap(archive: Uint8Array): Record<string, Uint8Array> {
  const map: Record<string, Uint8Array> = {};
  readStoredZipEntries(archive).forEach((entry) => {
    map[entry.name] = entry.data;
  });
  return map;
}
