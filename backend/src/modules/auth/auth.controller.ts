import { Controller, Post, Body, HttpCode, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

import { AuthService } from './auth.service';

class TokenRequest {
  @ApiProperty({ example: 'client_credentials' })
  @IsString()
  @IsNotEmpty()
  grant_type: string;

  @ApiProperty({ example: 'your_client_id' })
  @IsString()
  @IsNotEmpty()
  client_id: string;

  @ApiProperty({ example: 'your_client_secret' })
  @IsString()
  @IsNotEmpty()
  client_secret: string;
}

class TokenResponse {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  access_token: string;

  @ApiProperty({ example: 'Bearer' })
  token_type: string;

  @ApiProperty({ example: 86400 })
  expires_in: number;

  @ApiProperty({ example: 'read write' })
  scope: string;
}

@ApiTags('Authentication')
@Controller('/oauth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Get access token',
    description: 'OAuth2 Client Credentials flow to obtain JWT access token'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Access token generated successfully',
    type: TokenResponse
  })
  @ApiResponse({ 
    status: 401, 
    description: 'Invalid client credentials' 
  })
  async getToken(@Body() tokenRequest: TokenRequest): Promise<TokenResponse> {
    if (tokenRequest.grant_type !== 'client_credentials') {
      throw new UnauthorizedException('Unsupported grant type');
    }

    return this.authService.login(
      tokenRequest.client_id,
      tokenRequest.client_secret,
    );
  }
}
