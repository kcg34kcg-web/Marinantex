type CompressionOptions = {
  maxSizeMB?: number;
  maxWidthOrHeight?: number;
  useWebWorker?: boolean;
  [key: string]: unknown;
};

export default async function imageCompression<T = File>(file: T, _options?: CompressionOptions): Promise<T> {
  return file;
}
