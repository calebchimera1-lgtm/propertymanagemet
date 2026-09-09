import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@/common/decorators';
import { PrismaService } from '@/prisma/prisma.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  @Public()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiOkResponse({ description: 'The process is running.' })
  live() {
    // Deliberately says nothing about versions, hosts or dependencies.
    return { status: 'ok' };
  }

  @Get('ready')
  @Public()
  @ApiOperation({ summary: 'Readiness probe (checks the database)' })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      return { status: 'degraded', database: 'down' };
    }
  }
}
