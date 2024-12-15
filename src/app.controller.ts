import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  async getHealth() {
    return {
      status: 'ok',
      time: new Date().toISOString(),
      env: process.env.NODE_ENV || 'development'
    };
  }
}
