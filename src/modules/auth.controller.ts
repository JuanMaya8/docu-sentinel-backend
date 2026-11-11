import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthRequiredError, DomainError, type AuthService, type AuthSession, type User } from '../domain';
import { CurrentUser, Public } from '../http/auth.guard';
import { LoginDoc, RegisterDoc } from '../http/dto';
import { TOKENS } from '../tokens';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(@Inject(TOKENS.AUTH) private readonly auth: AuthService | null) {}

  private service(): AuthService {
    if (!this.auth) throw new DomainError(404, 'AUTH_DISABLED', 'Las cuentas de usuario no están activadas en este servidor (falta JWT_SECRET).');
    return this.auth;
  }

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Crea una cuenta y devuelve una sesión (token JWT)' })
  @ApiBody({ type: RegisterDoc })
  register(@Body() body: unknown): Promise<AuthSession> {
    return this.service().register(body);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Inicia sesión con correo y contraseña' })
  @ApiBody({ type: LoginDoc })
  login(@Body() body: unknown): Promise<AuthSession> {
    return this.service().login(body);
  }

  @Public()
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Usuario de la sesión actual' })
  me(@CurrentUser() user?: User): User {
    this.service();
    if (!user) throw new AuthRequiredError();
    return user;
  }
}
