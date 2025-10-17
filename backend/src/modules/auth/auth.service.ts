import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export interface JwtPayload {
  sub: string;
  clientId: string;
  scopes: string[];
  iat?: number;
  exp?: number;
}

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async validateClientCredentials(clientId: string, clientSecret: string): Promise<JwtPayload | null> {
    // In production, validate against database of registered clients
    // For now, use environment variables for demo
    const validClientId = this.configService.get('OAUTH_CLIENT_ID');
    const validClientSecret = this.configService.get('OAUTH_CLIENT_SECRET');

    if (clientId === validClientId && clientSecret === validClientSecret) {
      return {
        sub: clientId,
        clientId,
        scopes: ['read', 'write'], // Default scopes
      };
    }

    return null;
  }

  async generateAccessToken(payload: JwtPayload): Promise<string> {
    return this.jwtService.sign(payload);
  }

  async validateToken(token: string): Promise<JwtPayload> {
    try {
      return this.jwtService.verify(token);
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  async login(clientId: string, clientSecret: string) {
    const payload = await this.validateClientCredentials(clientId, clientSecret);
    
    if (!payload) {
      throw new UnauthorizedException('Invalid client credentials');
    }

    const accessToken = await this.generateAccessToken(payload);

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 86400, // 24 hours in seconds
      scope: payload.scopes.join(' '),
    };
  }
}
