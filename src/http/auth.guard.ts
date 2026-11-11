import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, createParamDecorator } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthRequiredError, type AuthService, type User } from '../domain';
import { TOKENS } from '../tokens';

const PUBLIC_KEY = 'ds:public';
/** Marks a controller or route as reachable without a session (health, login, register, metrics). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);

export interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: User;
}

export function bearer(req: AuthedRequest): string | undefined {
  const h = req.headers.authorization;
  const v = Array.isArray(h) ? h[0] : h;
  const m = v ? /^Bearer\s+(.+)$/i.exec(v) : null;
  return m ? m[1].trim() : undefined;
}

/**
 * When accounts are enabled (JWT_SECRET set): every non-public route needs `Authorization: Bearer <token>` and the user
 * is attached to the request. When disabled (`auth` is null) everything stays open, exactly like before.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TOKENS.AUTH) private readonly auth: AuthService | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AuthedRequest & { method: string }>();
    if (!this.auth || req.method === 'OPTIONS') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    const user = await this.auth.authenticate(bearer(req));
    if (user) req.user = user;
    if (isPublic) return true;
    if (!user) throw new AuthRequiredError(bearer(req) ? 'Tu sesión expiró o no es válida. Inicia sesión de nuevo.' : 'Inicia sesión para continuar.');
    return true;
  }
}

/** The owner id to scope data by: the user's id when accounts are enabled, undefined otherwise. */
export const Owner = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | undefined => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user?.id;
});

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): User | undefined => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});
