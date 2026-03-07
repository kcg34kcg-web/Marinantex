export interface ZipEntry {
  name: string;
  data: string | Uint8Array;
}

interface NormalizedZipEntry {
  name: string;
  nameBytes: Uint8Array;
  dataBytes: Uint8Array;
  crc32: number;
  localHeaderOffset: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let j = 0; j < 8; j += 1) {
      if ((value & 1) === 1) {
        value = 0xedb88320 ^ (value >>> 1);
      } else {
        value >>>= 1;
      }
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(input: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function ensureBytes(data: string | Uint8Array): Uint8Array {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  return data;
}

function writeUInt16LE(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUInt32LE(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function localFileHeaderLength(nameLength: number): number {
  return 30 + nameLength;
}

function centralDirectoryHeaderLength(nameLength: number): number {
  return 46 + nameLength;
}

function normalizeEntries(entries: ZipEntry[]): NormalizedZipEntry[] {
  let offset = 0;

  return entries.map((entry) => {
    const nameBytes = new TextEncoder().encode(entry.name);
    const dataBytes = ensureBytes(entry.data);
    const item: NormalizedZipEntry = {
      name: entry.name,
      nameBytes,
      dataBytes,
      crc32: crc32(dataBytes),
      localHeaderOffset: offset,
    };

    offset += localFileHeaderLength(nameBytes.length) + dataBytes.length;
    return item;
  });
}

export function buildZipArchive(entries: ZipEntry[]): Uint8Array {
  const normalized = normalizeEntries(entries);

  const localSectionSize = normalized.reduce(
    (sum, entry) => sum + localFileHeaderLength(entry.nameBytes.length) + entry.dataBytes.length,
    0,
  );

  const centralDirectorySize = normalized.reduce(
    (sum, entry) => sum + centralDirectoryHeaderLength(entry.nameBytes.length),
    0,
  );

  const endOfCentralDirectorySize = 22;
  const totalSize = localSectionSize + centralDirectorySize + endOfCentralDirectorySize;

  const output = new Uint8Array(totalSize);
  let cursor = 0;

  normalized.forEach((entry) => {
    writeUInt32LE(output, cursor, 0x04034b50);
    writeUInt16LE(output, cursor + 4, 20);
    writeUInt16LE(output, cursor + 6, 0);
    writeUInt16LE(output, cursor + 8, 0);
    writeUInt16LE(output, cursor + 10, 0);
    writeUInt16LE(output, cursor + 12, 0);
    writeUInt32LE(output, cursor + 14, entry.crc32);
    writeUInt32LE(output, cursor + 18, entry.dataBytes.length);
    writeUInt32LE(output, cursor + 22, entry.dataBytes.length);
    writeUInt16LE(output, cursor + 26, entry.nameBytes.length);
    writeUInt16LE(output, cursor + 28, 0);

    output.set(entry.nameBytes, cursor + 30);
    output.set(entry.dataBytes, cursor + 30 + entry.nameBytes.length);

    cursor += localFileHeaderLength(entry.nameBytes.length) + entry.dataBytes.length;
  });

  const centralDirectoryOffset = cursor;

  normalized.forEach((entry) => {
    writeUInt32LE(output, cursor, 0x02014b50);
    writeUInt16LE(output, cursor + 4, 20);
    writeUInt16LE(output, cursor + 6, 20);
    writeUInt16LE(output, cursor + 8, 0);
    writeUInt16LE(output, cursor + 10, 0);
    writeUInt16LE(output, cursor + 12, 0);
    writeUInt16LE(output, cursor + 14, 0);
    writeUInt32LE(output, cursor + 16, entry.crc32);
    writeUInt32LE(output, cursor + 20, entry.dataBytes.length);
    writeUInt32LE(output, cursor + 24, entry.dataBytes.length);
    writeUInt16LE(output, cursor + 28, entry.nameBytes.length);
    writeUInt16LE(output, cursor + 30, 0);
    writeUInt16LE(output, cursor + 32, 0);
    writeUInt16LE(output, cursor + 34, 0);
    writeUInt16LE(output, cursor + 36, 0);
    writeUInt32LE(output, cursor + 38, 0);
    writeUInt32LE(output, cursor + 42, entry.localHeaderOffset);

    output.set(entry.nameBytes, cursor + 46);
    cursor += centralDirectoryHeaderLength(entry.nameBytes.length);
  });

  writeUInt32LE(output, cursor, 0x06054b50);
  writeUInt16LE(output, cursor + 4, 0);
  writeUInt16LE(output, cursor + 6, 0);
  writeUInt16LE(output, cursor + 8, normalized.length);
  writeUInt16LE(output, cursor + 10, normalized.length);
  writeUInt32LE(output, cursor + 12, centralDirectorySize);
  writeUInt32LE(output, cursor + 16, centralDirectoryOffset);
  writeUInt16LE(output, cursor + 20, 0);

  return output;
}
