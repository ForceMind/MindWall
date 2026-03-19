import {
  Controller,
  Get,
  Post,
  Delete,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import 'multer';
import { AdminGuard } from './admin.guard';
import { AdminBackupService } from './admin-backup.service';

@Controller('admin/backup')
@UseGuards(AdminGuard)
export class AdminBackupController {
  private readonly logger = new Logger(AdminBackupController.name);

  constructor(private readonly backupService: AdminBackupService) {}

  @Get('download')
  async downloadBackup(@Res() res: Response) {
    const backup = await this.backupService.exportBackup();
    const filename = `mindwall-backup-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`;

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(backup, null, 2));
  }

  @Get('info')
  async getInfo() {
    return this.backupService.getBackupInfo();
  }

  @Post('restore')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 200 * 1024 * 1024 } }))
  async restoreBackup(@UploadedFile() file: any) {
    if (!file || !file.buffer) {
      throw new BadRequestException('No file uploaded');
    }
    const content = file.buffer.toString('utf-8');
    let data: any;
    try {
      data = JSON.parse(content);
    } catch {
      throw new BadRequestException('Invalid JSON file');
    }
    if (!data._mindwall_backup || !data.tables) {
      throw new BadRequestException('Invalid backup file format');
    }
    const result = await this.backupService.importBackup(data);
    this.logger.warn(`Backup restored: ${JSON.stringify(result)}`);
    return result;
  }

  @Delete('reset')
  async resetAllData() {
    const result = await this.backupService.resetAllData();
    this.logger.warn('All user data has been reset');
    return result;
  }
}
