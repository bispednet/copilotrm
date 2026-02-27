import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

export interface PgRuntimeOptions {
  connectionString: string;
  migrationsDir?: string;
}

export class PgRuntime {
  readonly pool: Pool;
  readonly migrationsDir: string;

  constructor(opts: PgRuntimeOptions) {
    this.pool = new Pool({ connectionString: opts.connectionString });
    this.migrationsDir = opts.migrationsDir ?? join(process.cwd(), '..', '..', 'infra', 'migrations');
  }

  async health(): Promise<{ ok: boolean; now?: string; error?: string }> {
    try {
      const res = await this.pool.query<{ now: string }>('select now()::text as now');
      return { ok: true, now: res.rows[0]?.now };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async ensureMigrationsTable(): Promise<void> {
    await this.pool.query(`
      create table if not exists schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `);
  }

  async runMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
    await this.ensureMigrationsTable();
    if (!existsSync(this.migrationsDir)) return { applied: [], skipped: [] };

    const files = readdirSync(this.migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const appliedRows = await this.pool.query<{ id: string }>('select id from schema_migrations');
    const appliedSet = new Set(appliedRows.rows.map((r) => r.id));
    const applied: string[] = [];
    const skipped: string[] = [];

    for (const file of files) {
      if (appliedSet.has(file)) {
        skipped.push(file);
        continue;
      }
      const sql = readFileSync(join(this.migrationsDir, file), 'utf8');
      const client = await this.pool.connect();
      try {
        await client.query('begin');
        await client.query(sql);
        await client.query('insert into schema_migrations (id) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    }

    return { applied, skipped };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
