/**
 * Registry of Supabase tables exposed in the Admin console.
 * Edits go through service-role APIs and write back to Supabase.
 */

export type AdminColumnType = 'text' | 'number' | 'boolean' | 'json' | 'timestamp' | 'array';

export type AdminColumn = {
  name: string;
  type: AdminColumnType;
  /** Shown in the grid (heavy JSON can be listed but truncated) */
  list?: boolean;
  editable?: boolean;
  required?: boolean;
  /** Hint for editors */
  description?: string;
};

export type AdminTableConfig = {
  name: string;
  label: string;
  description: string;
  primaryKey: string;
  /** Default sort column */
  orderBy: string;
  ascending?: boolean;
  columns: AdminColumn[];
  /** Allow insert / update / delete */
  canInsert: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  /** Tables that can get very large — smaller page size */
  pageSize?: number;
};

const col = (
  name: string,
  type: AdminColumnType,
  opts: Partial<AdminColumn> = {},
): AdminColumn => ({
  name,
  type,
  list: opts.list ?? true,
  editable: opts.editable ?? true,
  required: opts.required ?? false,
  description: opts.description,
});

export const ADMIN_TABLES: AdminTableConfig[] = [
  {
    name: 'dashboard_auth',
    label: 'Users & roles',
    description: 'Who can sign in, login state, and roles (viewer / responder / admin).',
    primaryKey: 'id',
    orderBy: 'last_login_at',
    ascending: false,
    canInsert: true,
    canUpdate: true,
    canDelete: true,
    columns: [
      col('id', 'text', { editable: false, list: true }),
      col('email', 'text', { required: true, description: 'Must be @likewize.com' }),
      col('role', 'text', {
        required: true,
        description: 'viewer | responder | admin',
      }),
      col('authenticated', 'boolean'),
      col('last_login_at', 'timestamp', { editable: false }),
      col('last_logout_at', 'timestamp', { editable: false }),
      col('created_at', 'timestamp', { editable: false, list: false }),
      col('updated_at', 'timestamp', { editable: false, list: false }),
    ],
  },
  {
    name: 'alert_subscriptions',
    label: 'Alert subscriptions',
    description: 'Email digest enrollments (clients / business lines).',
    primaryKey: 'id',
    orderBy: 'created_at',
    ascending: false,
    canInsert: true,
    canUpdate: true,
    canDelete: true,
    columns: [
      col('id', 'text', { editable: false }),
      col('email', 'text', { required: true }),
      col('active', 'boolean'),
      col('all_clients', 'boolean'),
      col('clients', 'array', { description: 'JSON array of client names' }),
      col('all_business_lines', 'boolean'),
      col('business_lines', 'array', { description: 'JSON array of line codes' }),
      col('unsubscribe_token', 'text', { editable: false, list: false }),
      col('last_notified_at', 'timestamp'),
      col('created_at', 'timestamp', { editable: false }),
      col('updated_at', 'timestamp', { editable: false, list: false }),
    ],
  },
  {
    name: 'thread_feedback',
    label: 'Thread feedback',
    description: 'Star ratings and comments on insight threads.',
    primaryKey: 'id',
    orderBy: 'created_at',
    ascending: false,
    canInsert: false,
    canUpdate: true,
    canDelete: true,
    columns: [
      col('id', 'text', { editable: false }),
      col('thread_url', 'text', { editable: false }),
      col('title', 'text'),
      col('source', 'text'),
      col('company', 'text'),
      col('client', 'text'),
      col('pillar', 'text'),
      col('business_line', 'text'),
      col('sentiment', 'text'),
      col('useful', 'boolean'),
      col('rating', 'number'),
      col('comment', 'text'),
      col('viewer_key', 'text', { editable: false, list: false }),
      col('mention_id', 'text', { list: false }),
      col('reddit_id', 'text', { list: false }),
      col('active_filters', 'json', { list: false }),
      col('why_reasons', 'json', { list: false }),
      col('created_at', 'timestamp', { editable: false }),
    ],
  },
  {
    name: 'job_runs',
    label: 'Job runs',
    description: 'Cron / manual job history (mostly read-only; you can delete noise).',
    primaryKey: 'id',
    orderBy: 'started_at',
    ascending: false,
    canInsert: false,
    canUpdate: true,
    canDelete: true,
    pageSize: 50,
    columns: [
      col('id', 'text', { editable: false }),
      col('job_name', 'text', { editable: false }),
      col('trigger', 'text'),
      col('status', 'text', { description: 'running | success | error' }),
      col('started_at', 'timestamp', { editable: false }),
      col('finished_at', 'timestamp'),
      col('duration_ms', 'number'),
      col('message', 'text'),
      col('error', 'text'),
      col('details', 'json', { list: false }),
    ],
  },
  {
    name: 'mentions',
    label: 'Mentions',
    description: 'Ingested threads (large). Edit carefully; raw_data is heavy.',
    primaryKey: 'id',
    orderBy: 'created_at',
    ascending: false,
    canInsert: false,
    canUpdate: true,
    canDelete: true,
    pageSize: 25,
    columns: [
      col('id', 'text', { editable: false, list: false }),
      col('reddit_id', 'text', { editable: false }),
      col('source', 'text'),
      col('title', 'text'),
      col('content', 'text', { list: false }),
      col('url', 'text', { list: false }),
      col('author', 'text'),
      col('retailer', 'text'),
      col('company', 'text'),
      col('competitor', 'text', { list: false }),
      col('product_type', 'text', { list: false }),
      col('subreddit', 'text'),
      col('sentiment', 'text'),
      col('pillar', 'text'),
      col('confidence', 'number'),
      col('created_at', 'timestamp'),
      col('created_at_db', 'timestamp', { editable: false, list: false }),
      col('raw_data', 'json', { list: false, editable: true }),
    ],
  },
  {
    name: 'retailer_daily_stats',
    label: 'Retailer daily stats',
    description: 'Optional aggregate stats by retailer/day.',
    primaryKey: 'id',
    orderBy: 'date',
    ascending: false,
    canInsert: true,
    canUpdate: true,
    canDelete: true,
    columns: [
      col('id', 'text', { editable: false }),
      col('date', 'text', { required: true }),
      col('retailer', 'text', { required: true }),
      col('total_mentions', 'number'),
      col('positive_count', 'number'),
      col('neutral_count', 'number'),
      col('negative_count', 'number'),
      col('avg_confidence', 'number'),
      col('created_at', 'timestamp', { editable: false, list: false }),
      col('updated_at', 'timestamp', { editable: false, list: false }),
    ],
  },
];

export function getAdminTable(name: string): AdminTableConfig | null {
  return ADMIN_TABLES.find((t) => t.name === name) || null;
}

export function isAllowedAdminTable(name: string): boolean {
  return !!getAdminTable(name);
}
