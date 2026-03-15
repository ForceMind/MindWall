import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BackendSystemModule } from './system/backend-system.module';

@Module({
  imports: [BackendSystemModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
