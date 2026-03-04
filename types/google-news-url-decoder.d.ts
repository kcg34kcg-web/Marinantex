declare module 'google-news-url-decoder' {
  export type DecodeResult = {
    status: boolean;
    source_url?: string;
    decoded_url?: string;
    message?: string;
  };

  export class GoogleDecoder {
    constructor(proxy?: string | null);
    decode(sourceUrl: string): Promise<DecodeResult>;
    decodeBatch(sourceUrls: string[]): Promise<DecodeResult[]>;
  }
}
