import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AdminConfigService } from './admin-config.service';
import { AdminGuard } from './admin.guard';
import type { RuntimeConfig } from './admin.types';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminConfigService: AdminConfigService) {}

  @Get('config')
  async getConfig() {
    return this.adminConfigService.getPublicConfig();
  }

  @Put('config')
  async updateConfig(@Body() body: Record<string, unknown>) {
    const payload: RuntimeConfig = {};

    if (typeof body.openai_base_url === 'string') {
      payload.openai_base_url = body.openai_base_url;
    }
    if (typeof body.openai_api_key === 'string') {
      payload.openai_api_key = body.openai_api_key;
    }
    if (typeof body.openai_embedding_api_key === 'string') {
      payload.openai_embedding_api_key = body.openai_embedding_api_key;
    }
    if (typeof body.openai_model === 'string') {
      payload.openai_model = body.openai_model;
    }
    if (typeof body.openai_embedding_model === 'string') {
      payload.openai_embedding_model = body.openai_embedding_model;
    }
    if (typeof body.openai_input_price === 'number') {
      payload.openai_input_price = body.openai_input_price;
    }
    if (typeof body.openai_output_price === 'number') {
      payload.openai_output_price = body.openai_output_price;
    }
    if (typeof body.web_origin === 'string') {
      payload.web_origin = body.web_origin;
    }

    return this.adminConfigService.updateConfig(payload);
  }

  @Post('config/test')
  async testConfig(@Body() body: Record<string, unknown>) {
    const payload: RuntimeConfig = {};

    if (typeof body.openai_base_url === 'string') {
      payload.openai_base_url = body.openai_base_url;
    }
    if (typeof body.openai_api_key === 'string') {
      payload.openai_api_key = body.openai_api_key;
    }
    if (typeof body.openai_embedding_api_key === 'string') {
      payload.openai_embedding_api_key = body.openai_embedding_api_key;
    }
    if (typeof body.openai_model === 'string') {
      payload.openai_model = body.openai_model;
    }
    if (typeof body.openai_embedding_model === 'string') {
      payload.openai_embedding_model = body.openai_embedding_model;
    }

    return this.adminConfigService.testAiConnectivity(payload);
  }
}
