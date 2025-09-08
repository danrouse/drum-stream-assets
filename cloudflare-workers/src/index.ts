import { Kysely, sql } from 'kysely';
import { D1Dialect } from 'kysely-d1';
import { Database } from './database';
import { loadTemplate, loadCSS, loadJavaScript } from './template-loader';

interface Env {
  DB: D1Database;
  DATABASE_API_KEY?: string;
}

interface RequestWithDetails {
  id: number;
  query: string;
  requester: string | null;
  createdAt: string;
  status: string;
  fulfilledAt: string | null;
  songId: number | null;
  title: string | null;
  artist: string | null;
  album: string | null;
  duration: number | null;
  streamId: number | null;
  streamStartedAt: string | null;
  streamEndedAt: string | null;
  chronologicalNumber?: number;
}

interface StreamGroup {
  streamId: number | null;
  streamStartedAt: string | null;
  streamEndedAt: string | null;
  requests: RequestWithDetails[];
}

interface RequestsData {
  readyRequests: RequestWithDetails[];
  fulfilledRequests: StreamGroup[];
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS for all requests
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      const db = new Kysely<Database>({
        dialect: new D1Dialect({ database: env.DB }),
      });

      // Database proxy API endpoints (requires authentication)
      if (url.pathname.startsWith('/api/db/')) {
        // Check for API key authentication
        const authHeader = request.headers.get('Authorization');
        const apiKey = authHeader?.replace('Bearer ', '');

        if (!env.DATABASE_API_KEY || !apiKey || apiKey !== env.DATABASE_API_KEY) {
          return new Response(JSON.stringify({ error: 'Unauthorized - Invalid or missing API key' }), {
            status: 401,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return await handleDatabaseProxy(request, db, env, corsHeaders);
      }

      // Original read-only API endpoints
      if (url.pathname === '/api/stats') {
        const stats = await getStats(db);
        return new Response(JSON.stringify(stats), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (url.pathname === '/api/requests') {
        const requests = await getAllSongRequestsWithDetails(db);
        return new Response(JSON.stringify(requests), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Handle main webapp (only allow GET for webapp)
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '')) {
        const requests = await getAllSongRequestsWithDetails(db);
        const html = generateHTML(requests);
        return new Response(html, {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      // 404 for other paths
      return new Response('Not found', { status: 404 });

    } catch (error) {
      console.error('Error handling request:', error);
      return new Response('Internal server error', { status: 500 });
    }
  },
};

// Utility function to serialize results with BigInt handling
function serializeResult(result: any): string {
  return JSON.stringify(result, (key, value) =>
    typeof value === 'bigint' ? Number(value) : value
  );
}

async function handleDatabaseProxy(request: Request, db: Kysely<Database>, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;

  try {
    // Parse the path to get table and operation
    const pathParts = url.pathname.split('/');
    // Expected format: /api/db/{operation}
    const operation = pathParts[3];

    if (method === 'POST') {
      const body = await request.json() as any;

      switch (operation) {
        case 'query':
          // Execute raw SQL query with parameters using D1 directly
          const { sql: sqlString, parameters } = body;

          // Use D1 database directly to handle parameters properly
          const result = await env.DB.prepare(sqlString).bind(...(parameters || [])).all();

          return new Response(serializeResult(result), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });

        case 'select':
          // Handle select operations
          const { table, where, select: selectFields, orderBy, limit } = body;
          let query = db.selectFrom(table as any);

          if (selectFields) {
            query = query.select(selectFields);
          } else {
            query = query.selectAll();
          }

          if (where) {
            for (const condition of where) {
              query = query.where(condition.column, condition.operator, condition.value);
            }
          }

          if (orderBy) {
            for (const order of orderBy) {
              query = query.orderBy(order.column, order.direction);
            }
          }

          if (limit) {
            query = query.limit(limit);
          }

          const selectResult = await query.execute();
          return new Response(serializeResult(selectResult), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });

        case 'insert':
          // Handle insert operations
          const { table: insertTable, values } = body;
          const insertResult = await db.insertInto(insertTable as any)
            .values(values)
            .returning(['id'])
            .execute();
          return new Response(serializeResult(insertResult), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });

        case 'update':
          // Handle update operations
          const { table: updateTable, set, where: updateWhere } = body;
          let updateQuery = db.updateTable(updateTable as any).set(set);

          if (updateWhere) {
            for (const condition of updateWhere) {
              updateQuery = updateQuery.where(condition.column, condition.operator, condition.value);
            }
          }

          const updateResult = await updateQuery.execute();
          return new Response(serializeResult(updateResult), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });

        case 'delete':
          // Handle delete operations
          const { table: deleteTable, where: deleteWhere } = body;
          let deleteQuery = db.deleteFrom(deleteTable as any);

          if (deleteWhere) {
            for (const condition of deleteWhere) {
              deleteQuery = deleteQuery.where(condition.column, condition.operator, condition.value);
            }
          }

          const deleteResult = await deleteQuery.execute();
          return new Response(serializeResult(deleteResult), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });

        default:
          return new Response('Unknown operation', {
            status: 400,
            headers: corsHeaders
          });
      }
    }

    return new Response('Method not allowed for database proxy', {
      status: 405,
      headers: corsHeaders
    });

  } catch (error) {
    console.error('Database proxy error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(serializeResult({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

async function getStats(db: Kysely<Database>) {
  const [processing, ready, fulfilled, cancelled] = await Promise.all([
    db.selectFrom('songRequests').where('status', '=', 'processing').select(db.fn.count('id').as('count')).execute(),
    db.selectFrom('songRequests').where('status', '=', 'ready').select(db.fn.count('id').as('count')).execute(),
    db.selectFrom('songRequests').where('status', '=', 'fulfilled').select(db.fn.count('id').as('count')).execute(),
    db.selectFrom('songRequests').where('status', '=', 'cancelled').select(db.fn.count('id').as('count')).execute(),
  ]);

  return {
    processing: Number(processing[0]?.count || 0),
    ready: Number(ready[0]?.count || 0),
    fulfilled: Number(fulfilled[0]?.count || 0),
    cancelled: Number(cancelled[0]?.count || 0),
    total: Number(processing[0]?.count || 0) + Number(ready[0]?.count || 0) + Number(fulfilled[0]?.count || 0) + Number(cancelled[0]?.count || 0),
  };
}

async function getAllSongRequestsWithDetails(db: Kysely<Database>): Promise<RequestsData> {
  // Get all ready and fulfilled requests with song details
  const requests = await db
    .selectFrom('songRequests')
    .leftJoin('songs', 'songRequests.songId', 'songs.id')
    .where('songRequests.status', 'in', ['ready', 'fulfilled'])
    .select([
      'songRequests.id',
      'songRequests.query',
      'songRequests.requester',
      'songRequests.createdAt',
      'songRequests.status',
      'songRequests.fulfilledAt',
      'songRequests.songId',
      'songs.title',
      'songs.artist',
      'songs.album',
      'songs.duration',
    ])
    .orderBy('songRequests.createdAt', 'desc')
    .execute();

  // Get stream history to associate requests with streams
  const streams = await db
    .selectFrom('streamHistory')
    .select(['id', 'createdAt', 'endedAt'])
    .orderBy('createdAt', 'desc')
    .execute();

  // Sort streams by createdAt ascending for proper stream association
  const sortedStreams = [...streams].sort((a, b) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  // Associate each request with its stream
  const requestsWithStreams = requests.map(request => {
    // Find the stream this request belongs to
    // A request belongs to the most recent stream that started before or at the request time
    const requestTime = new Date(request.createdAt);

    // Find all streams that started before or at the request time
    const validStreams = streams.filter(stream => {
      const streamStart = new Date(stream.createdAt);
      return streamStart <= requestTime;
    });

    // Get the most recent valid stream (latest createdAt)
    const associatedStream = validStreams.reduce((latest, current) => {
      if (!latest) return current;
      return new Date(current.createdAt) > new Date(latest.createdAt) ? current : latest;
    }, null as typeof streams[0] | null);

    return {
      ...request,
      createdAt: request.createdAt.toString(),
      fulfilledAt: request.fulfilledAt ? request.fulfilledAt.toString() : null,
      streamId: associatedStream?.id || null,
      streamStartedAt: associatedStream?.createdAt ? associatedStream.createdAt.toString() : null,
      streamEndedAt: associatedStream?.endedAt ? associatedStream.endedAt.toString() : null,
    };
  });

  // Separate ready and fulfilled requests
  const readyRequests = requestsWithStreams.filter(r => r.status === 'ready');
  const fulfilledRequestsFlat = requestsWithStreams.filter(r => r.status === 'fulfilled');

  // Group fulfilled requests by stream
  const streamMap = new Map<number | null, StreamGroup>();

  fulfilledRequestsFlat.forEach(request => {
    const streamId = request.streamId;

    if (!streamMap.has(streamId)) {
      streamMap.set(streamId, {
        streamId,
        streamStartedAt: request.streamStartedAt,
        streamEndedAt: request.streamEndedAt,
        requests: []
      });
    }

    streamMap.get(streamId)!.requests.push(request);
  });

  // Convert to array and sort streams by start date (newest first)
  const streamGroups = Array.from(streamMap.values()).sort((a, b) => {
    if (!a.streamStartedAt && !b.streamStartedAt) return 0;
    if (!a.streamStartedAt) return 1;
    if (!b.streamStartedAt) return -1;
    return new Date(b.streamStartedAt).getTime() - new Date(a.streamStartedAt).getTime();
  });

  // Sort requests within each stream chronologically for numbering, then reverse for display
  streamGroups.forEach(stream => {
    // First sort chronologically (earliest first) to establish correct numbering
    const chronologicallySorted = stream.requests.sort((a: any, b: any) => {
      if (!a.fulfilledAt || !b.fulfilledAt) {
        // If no fulfilledAt, fall back to createdAt for ordering
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return new Date(a.fulfilledAt).getTime() - new Date(b.fulfilledAt).getTime();
    });

    // Add chronological numbers to each request
    chronologicallySorted.forEach((request: any, index: number) => {
      request.chronologicalNumber = index + 1;
    });

    // Then reverse for display (latest fulfilled first) while keeping the numbers
    stream.requests = chronologicallySorted.reverse();
  });

  return {
    readyRequests,
    fulfilledRequests: streamGroups
  };
}

function generateHTML(requests: RequestsData): string {
  const template = loadTemplate();
  const css = loadCSS();
  const js = loadJavaScript();

  // Calculate counts
  const readyCount = requests.readyRequests.length;
  const fulfilledCount = requests.fulfilledRequests.reduce(
    (total, stream) => total + stream.requests.length,
    0
  );

  // Safely serialize the requests data for embedding in HTML
  const serializedData = JSON.stringify(requests)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return template
    .replace('{{CSS_CONTENT}}', css)
    .replace('{{READY_COUNT}}', readyCount.toString())
    .replace('{{FULFILLED_COUNT}}', fulfilledCount.toString())
    .replace('{{REQUESTS_DATA}}', serializedData)
    .replace('{{JS_CONTENT}}', js);
}
