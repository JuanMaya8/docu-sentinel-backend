import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { UnauthorizedError, type AppConfig } from '../domain';
import { TOKENS } from '../tokens';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** When API_KEY is set, every non-read request must send the same value in `X-API-Key`. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(TOKENS.CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.apiKey || context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<{ method: string; headers: Record<string, string | string[] | undefined> }>();
    if (SAFE_METHODS.has(req.method)) return true;
    const sent = req.headers['x-api-key'];
    const a = Buffer.from(typeof sent === 'string' ? sent : '');
    const b = Buffer.from(this.config.apiKey);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new UnauthorizedError();
    return true;
  }
}
