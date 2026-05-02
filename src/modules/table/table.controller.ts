import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { TableService } from './table.service';
import {
  ChangeTableStatusDto,
  CreateTableDto,
  UpdateTableDto,
} from './dto/table.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Tables')
@ApiBearerAuth()
@Controller('tables')
export class TableController {
  constructor(private readonly service: TableService) {}

  @Get()
  list(@Query('venueId') venueId?: string) {
    return this.service.list(venueId);
  }

  @Post()
  @RequirePermissions('table.manage')
  create(@Body() dto: CreateTableDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('table.manage')
  update(@Param('id') id: string, @Body() dto: UpdateTableDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/status')
  changeStatus(@Param('id') id: string, @Body() dto: ChangeTableStatusDto) {
    return this.service.changeStatus(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('table.manage')
  async delete(@Param('id') id: string) {
    await this.service.delete(id);
  }
}
