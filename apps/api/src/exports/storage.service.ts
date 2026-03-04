import { Injectable } from "@nestjs/common";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

interface UploadedObjectResult {
  key: string;
  etag: string | null;
}

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT?.trim();
    this.bucket = process.env.S3_BUCKET?.trim() || "documents";

    this.client = new S3Client({
      region: process.env.S3_REGION?.trim() || "us-east-1",
      endpoint: endpoint && endpoint.length > 0 ? endpoint : undefined,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY?.trim() || "minioadmin",
        secretAccessKey: process.env.S3_SECRET_KEY?.trim() || "minioadmin123",
      },
    });
  }

  async uploadObject(
    key: string,
    payload: Buffer,
    contentType: string,
  ): Promise<UploadedObjectResult> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: payload,
        ContentType: contentType,
      }),
    );

    return {
      key,
      etag: result.ETag ?? null,
    };
  }

  async getSignedDownloadUrl(
    key: string,
    fileName: string,
    expiresInSeconds: number,
    contentType: string,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentType: contentType,
        ResponseContentDisposition: `attachment; filename="${fileName}"`,
      }),
      {
        expiresIn: expiresInSeconds,
      },
    );
  }
}
