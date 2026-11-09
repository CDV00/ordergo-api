import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { MAX_IMAGE_BYTES, StorageService } from './storage.service';

@ApiTags('Uploads')
@ApiBearerAuth()
@Controller('uploads')
export class StorageController {
  constructor(
    private readonly storage: StorageService,
    private readonly tenantCtx: TenantContextService,
  ) {}

  /** multipart/form-data, field `file`. Trả `{ url }` tương đối — client ghép với origin API. */
  @Post('images')
  @RequirePermissions('menu.manage')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      // +1 byte để StorageService trả lỗi tiếng Việt thay vì lỗi mặc định của multer
      limits: { fileSize: MAX_IMAGE_BYTES + 1, files: 1 },
    }),
  )
  async uploadImage(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException({ code: 'NO_FILE', message: 'Chưa chọn ảnh.' });
    }
    return this.storage.saveImage(this.tenantCtx.tenantId(), file.buffer);
  }
}
