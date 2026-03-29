import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { Readable } from 'stream';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>('cloudinary.cloudName'),
      api_key: this.configService.get<string>('cloudinary.apiKey'),
      api_secret: this.configService.get<string>('cloudinary.apiSecret'),
    });
  }

  async uploadChatImage(
    file: Express.Multer.File,
    senderId: string,
  ): Promise<{ url: string; publicId: string }> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException(
        `Invalid file type: ${file.mimetype}. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException(
        `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Max: 5MB`,
      );
    }

    try {
      const result = await this.uploadToCloudinary(file.buffer, {
        folder: 'takatak/chat',
        resource_type: 'image',
        transformation: [
          { width: 1080, height: 1080, crop: 'limit' },
          { quality: 'auto', fetch_format: 'auto' },
        ],
        context: `sender=${senderId}`,
      });

      this.logger.log(`Image uploaded: ${result.public_id} by ${senderId}`);

      return {
        url: result.secure_url,
        publicId: result.public_id,
      };
    } catch (error) {
      this.logger.error(`Upload failed for ${senderId}: ${(error as Error).message}`);
      throw new BadRequestException('Image upload failed. Please try again.');
    }
  }

  private uploadToCloudinary(
    buffer: Buffer,
    options: Record<string, any>,
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
        if (error) return reject(error);
        if (!result) return reject(new Error('No result from Cloudinary'));
        resolve(result);
      });
      const readable = new Readable();
      readable.push(buffer);
      readable.push(null);
      readable.pipe(stream);
    });
  }
}
