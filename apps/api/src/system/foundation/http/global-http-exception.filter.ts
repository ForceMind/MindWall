import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Response } from 'express';
import { ServerLogService } from '../../../telemetry/server-log.service';
import type { RequestWithContext } from './request-context.middleware';

@Injectable()
@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly serverLogService: ServerLogService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<RequestWithContext>();
    const response = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload =
      exception instanceof HttpException
        ? exception.getResponse()
        : null;

    const message = this.resolveMessage(payload, exception);
    const errorName = this.resolveErrorName(exception, status);

    void this.serverLogService.error('http.exception', message, {
      request_id: request.requestId || null,
      path: request.originalUrl,
      method: request.method,
      status,
      error: errorName,
      detail:
        exception instanceof Error
          ? exception.stack?.slice(0, 1000) || exception.message
          : String(exception),
    });

    response.status(status).json({
      statusCode: status,
      error: errorName,
      message,
      request_id: request.requestId || null,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    });
  }

  private resolveMessage(payload: unknown, exception: unknown) {
    if (Array.isArray((payload as { message?: unknown })?.message)) {
      return (payload as { message: unknown[] }).message
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .join('；');
    }

    if (typeof (payload as { message?: unknown })?.message === 'string') {
      return String((payload as { message: string }).message);
    }

    if (exception instanceof Error && exception.message) {
      return exception.message;
    }

    return '服务器处理请求失败，请稍后重试。';
  }

  private resolveErrorName(exception: unknown, status: number) {
    if (
      exception instanceof HttpException &&
      typeof (exception.getResponse() as { error?: unknown })?.error === 'string'
    ) {
      return String((exception.getResponse() as { error: string }).error);
    }

    if (status >= 500) {
      return 'Internal Server Error';
    }

    return 'Bad Request';
  }
}
