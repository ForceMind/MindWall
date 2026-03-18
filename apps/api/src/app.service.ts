import { Injectable } from '@nestjs/common';
import { getAppVersion } from './system/foundation/app-version';

@Injectable()
export class AppService {
  getServiceInfo() {
    const version = getAppVersion();

    return {
      name: '有间 API',
      status: 'running',
      version,
      time: new Date().toISOString(),
      endpoints: {
        health: '/health',
        auth: '/auth/*',
        onboarding: '/onboarding/*',
        contacts: '/contacts/*',
        match_engine: '/match-engine/*',
        sandbox: '/sandbox/*',
        admin: '/admin/*',
      },
    };
  }
}
