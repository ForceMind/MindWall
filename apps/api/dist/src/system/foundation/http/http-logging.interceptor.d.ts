import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ServerLogService } from '../../../telemetry/server-log.service';
export declare class HttpLoggingInterceptor implements NestInterceptor {
    private readonly serverLogService;
    constructor(serverLogService: ServerLogService);
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown>;
}
