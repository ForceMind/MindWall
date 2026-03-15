import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { ServerLogService } from '../../../telemetry/server-log.service';
import type { RequestWithContext } from './request-context.middleware';

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  constructor(private readonly serverLogService: ServerLogService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<RequestWithContext>();
    const startedAt = req.requestStartedAt || Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          void this.serverLogService.info('http.request', 'request completed', {
            request_id: req.requestId || null,
            method: req.method,
            path: req.originalUrl,
            duration_ms: Date.now() - startedAt,
          });
        },
      }),
    );
  }
}
