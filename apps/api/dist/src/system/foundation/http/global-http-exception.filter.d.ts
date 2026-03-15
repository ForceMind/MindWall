import { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { ServerLogService } from '../../../telemetry/server-log.service';
export declare class GlobalHttpExceptionFilter implements ExceptionFilter {
    private readonly serverLogService;
    constructor(serverLogService: ServerLogService);
    catch(exception: unknown, host: ArgumentsHost): void;
    private resolveMessage;
    private resolveErrorName;
}
