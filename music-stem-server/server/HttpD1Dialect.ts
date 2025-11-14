/**
 * HTTP-based Kysely dialect that proxies database operations through a Cloudflare Worker
 */
import {
  Dialect,
  DialectAdapter,
  Driver,
  Kysely,
  QueryCompiler,
  DatabaseIntrospector,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  CompiledQuery,
  DatabaseConnection,
  QueryResult,
} from 'kysely';

interface HttpD1Config {
  workerUrl: string;
  apiKey: string;
}

export class HttpD1Dialect implements Dialect {
  readonly config: HttpD1Config;

  constructor(config: HttpD1Config) {
    this.config = config;
  }

  createAdapter(): DialectAdapter {
    return new SqliteAdapter();
  }

  createDriver(): Driver {
    return new HttpD1Driver(this.config);
  }

  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }

  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
}

class HttpD1Driver implements Driver {
  readonly config: HttpD1Config;

  constructor(config: HttpD1Config) {
    this.config = config;
  }

  async init(): Promise<void> {
    // No initialization needed for HTTP client
  }

  async acquireConnection(): Promise<DatabaseConnection> {
    return new HttpD1Connection(this.config);
  }

  async beginTransaction(): Promise<void> {
    throw new Error('Transactions are not supported by D1');
  }

  async commitTransaction(): Promise<void> {
    throw new Error('Transactions are not supported by D1');
  }

  async rollbackTransaction(): Promise<void> {
    throw new Error('Transactions are not supported by D1');
  }

  async releaseConnection(): Promise<void> {
    // No cleanup needed for HTTP connections
  }

  async destroy(): Promise<void> {
    // No cleanup needed
  }
}

class HttpD1Connection implements DatabaseConnection {
  readonly config: HttpD1Config;

  constructor(config: HttpD1Config) {
    this.config = config;
  }

  async executeQuery<O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> {
    const { sql, parameters } = compiledQuery;

    try {
      const response = await fetch(`${this.config.workerUrl}/api/db/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          sql,
          parameters: parameters || [],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();

      // Transform D1 result format to Kysely format
      // D1's .all() returns { results: [], meta: { changes, last_row_id } }
      return {
        rows: result.results || [],
        numAffectedRows: BigInt(result.meta?.changes || 0),
        insertId: result.meta?.last_row_id ? BigInt(result.meta.last_row_id) : undefined,
      };
    } catch (error) {
      console.error('HttpD1Connection query error:', error);
      throw error;
    }
  }

  async *streamQuery<O>(): AsyncIterableIterator<QueryResult<O>> {
    throw new Error('Streaming queries not supported by HttpD1Connection');
  }
}
