import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  }

  async onModuleInit() {
    await this.$connect();
    
    // Enable PostGIS extension
    await this.$executeRaw`CREATE EXTENSION IF NOT EXISTS postgis;`;
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  // Helper method to execute raw geometry queries
  async executeGeometryQuery(query: string, params: any[] = []) {
    return this.$queryRawUnsafe(query, ...params);
  }

  // Helper to calculate area from PostGIS geometry
  async calculateArea(geometryColumn: string, tableName: string, whereClause?: string) {
    const query = `
      SELECT ST_Area(${geometryColumn}) as area
      FROM ${tableName}
      ${whereClause ? `WHERE ${whereClause}` : ''}
    `;
    return this.$queryRawUnsafe(query);
  }

  // Helper to calculate length from PostGIS geometry
  async calculateLength(geometryColumn: string, tableName: string, whereClause?: string) {
    const query = `
      SELECT ST_Length(${geometryColumn}) as length
      FROM ${tableName}
      ${whereClause ? `WHERE ${whereClause}` : ''}
    `;
    return this.$queryRawUnsafe(query);
  }
}
