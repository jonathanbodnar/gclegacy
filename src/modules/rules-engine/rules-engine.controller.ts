import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

import { RulesEngineService } from './rules-engine.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

class CreateRuleSetRequest {
  @ApiProperty({ example: 'Standard Commercial Rules' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '1.0' })
  @IsString()
  @IsNotEmpty()
  version: string;

  @ApiProperty({ 
    example: `version: 1
units:
  linear: ft
  area: ft2
rules:
  - when: { feature: wall, partition_type: "PT-1" }
    materials:
      - sku: "STUD-362-20GA"
        qty: "length_ft * 0.75"
      - sku: "GWB-58X-TypeX"
        qty: "length_ft * height_ft * 2 / 32"`,
    description: 'YAML or JSON rules content'
  })
  @IsString()
  @IsNotEmpty()
  rules: string;
}

class CreateRuleSetResponse {
  @ApiProperty({ example: 'mrs_abc123' })
  ruleSetId: string;
}

@ApiTags('Rules Engine')
@Controller('rules')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class RulesEngineController {
  constructor(private readonly rulesEngineService: RulesEngineService) {}

  @Post('rulesets')
  @ApiOperation({ 
    summary: 'Create materials rule set',
    description: 'Create a new rule set for materials mapping from extracted features'
  })
  @ApiResponse({ 
    status: 201, 
    description: 'Rule set created successfully',
    type: CreateRuleSetResponse
  })
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid rule set format' 
  })
  async createRuleSet(@Body() createRequest: CreateRuleSetRequest): Promise<CreateRuleSetResponse> {
    const ruleSetId = await this.rulesEngineService.createRuleSet(
      createRequest.name,
      createRequest.version,
      createRequest.rules,
    );

    return { ruleSetId };
  }
}
