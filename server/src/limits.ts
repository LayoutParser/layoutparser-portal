import { Transform, type TransformCallback } from 'node:stream';

import {
  Busboy as createBusboy,
  type BusboyInstance,
  type BusboyFileStream,
} from '@fastify/busboy';

export class PayloadLimitError extends Error {
  public readonly statusCode = 413;

  public constructor(public readonly limitKind: 'request' | 'document') {
    super(
      limitKind === 'request' ? 'Request payload limit exceeded.' : 'Document size limit exceeded.'
    );
    this.name = 'PayloadLimitError';
  }
}

export class MultipartPayloadError extends Error {
  public readonly statusCode = 400;

  public constructor() {
    super('Invalid multipart payload.');
    this.name = 'MultipartPayloadError';
  }
}

export interface PayloadLimiterOptions {
  readonly contentType: string | undefined;
  readonly requestLimitBytes: number;
  readonly documentLimitBytes: number;
  readonly documentField: string;
  readonly documentFieldAliases?: readonly string[];
  readonly onLimit?: (kind: 'request' | 'document') => void;
}

export class PayloadLimitTransform extends Transform {
  public receivedEncodedLength = 0;

  private readonly multipartParser: BusboyInstance | null;
  private documentBytes = 0;
  private pendingError: Error | null = null;

  private isDocumentField(fieldName: string): boolean {
    return (
      fieldName === this.options.documentField ||
      this.options.documentFieldAliases?.includes(fieldName) === true
    );
  }

  private createLimitError(kind: 'request' | 'document'): PayloadLimitError {
    this.options.onLimit?.(kind);
    return new PayloadLimitError(kind);
  }

  public constructor(private readonly options: PayloadLimiterOptions) {
    super();

    if (!options.contentType?.toLowerCase().startsWith('multipart/form-data')) {
      this.multipartParser = null;
      return;
    }

    try {
      this.multipartParser = createBusboy({
        headers: { 'content-type': options.contentType },
        limits: { fileSize: options.documentLimitBytes + 1 },
      });
    } catch {
      throw new MultipartPayloadError();
    }

    this.multipartParser.on('file', (fieldName: string, file: BusboyFileStream) => {
      file.on('data', (chunk: Buffer) => {
        if (!this.isDocumentField(fieldName) || this.pendingError) {
          return;
        }

        this.documentBytes += chunk.byteLength;
        if (this.documentBytes > this.options.documentLimitBytes) {
          this.pendingError = this.createLimitError('document');
        }
      });
      file.on('limit', () => {
        if (this.isDocumentField(fieldName)) {
          this.pendingError = this.createLimitError('document');
        }
      });
      file.resume();
    });
    this.multipartParser.on('error', () => {
      this.pendingError = new MultipartPayloadError();
    });
  }

  public override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    this.receivedEncodedLength += chunk.byteLength;
    if (this.receivedEncodedLength > this.options.requestLimitBytes) {
      callback(this.createLimitError('request'));
      return;
    }

    if (!this.multipartParser) {
      callback(null, chunk);
      return;
    }

    this.multipartParser.write(chunk, (error: Error | null | undefined) => {
      if (error) {
        callback(new MultipartPayloadError());
        return;
      }

      if (this.pendingError) {
        callback(this.pendingError);
        return;
      }

      callback(null, chunk);
    });
  }

  public override _flush(callback: TransformCallback): void {
    if (!this.multipartParser) {
      callback();
      return;
    }

    this.multipartParser.end((error: Error | null | undefined) => {
      if (error) {
        callback(new MultipartPayloadError());
        return;
      }

      callback(this.pendingError);
    });
  }

  public override _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this.multipartParser?.destroy();
    callback(error);
  }
}
