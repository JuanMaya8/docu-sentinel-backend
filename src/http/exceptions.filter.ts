import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { DomainError } from '../domain';

interface HttpLikeError { status?: number; statusCode?: number; type?: string }

/** Every error leaves the API as `{ statusCode, code, message }` with a Spanish message (docs/CONTRACT.md). */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<{ status(n: number): { json(b: unknown): void } }>();
    if (exception instanceof DomainError) {
      res.status(exception.status).json({ statusCode: exception.status, code: exception.code, message: exception.message, ...(exception.details ? { details: exception.details } : {}) });
      return;
    }
    const e = exception as HttpLikeError;
    if (e?.type === 'entity.too.large' || e?.status === 413 || e?.statusCode === 413) {
      res.status(413).json({ statusCode: 413, code: 'PAYLOAD_TOO_LARGE', message: 'El archivo de resultados es demasiado grande. Envía menos hallazgos o filas.' });
      return;
    }
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ statusCode: 400, code: 'INVALID_JSON', message: 'El cuerpo no es un JSON válido.' });
      return;
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = status === 404 ? 'NOT_FOUND' : status === 429 ? 'TOO_MANY_REQUESTS' : `HTTP_${status}`;
      const message = status === 404 ? 'Ruta no encontrada.' : status === 429 ? 'Demasiadas solicitudes. Intenta de nuevo en un momento.' : 'Solicitud no válida.';
      res.status(status).json({ statusCode: status, code, message });
      return;
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({ statusCode: 500, code: 'INTERNAL_ERROR', message: 'Ocurrió un error interno. Intenta de nuevo.' });
  }
}
