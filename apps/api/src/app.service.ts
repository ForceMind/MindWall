import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getServiceInfo() {
    return {
      name: 'MindWall API',
      status: 'running',
      version: process.env.npm_package_version || '0.0.1',
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
