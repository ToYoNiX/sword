/*
 * Just enough CalDAV to publish a calendar: create it, list its events with
 * their content in one request, and put or delete single events, with
 * ETags so nothing changed by someone else is overwritten. Uses fetch only.
 */
export class CalDavError extends Error {
  override name = 'CalDavError';
}

export interface RemoteEvent {
  /** The file name in the calendar, e.g. "sword-0a1b2c3d4e5f6789.ics". */
  name: string;
  etag: string | null;
  data: string;
}

export interface CalDavOptions {
  /** The calendar's URL: a collection, e.g. http://localhost:5232/assem/sword/. */
  url: string;
  username?: string;
  password?: string;
}

export class CalDav {
  readonly url: string;
  private readonly headers: Record<string, string>;

  constructor(options: CalDavOptions) {
    this.url = options.url.endsWith('/') ? options.url : `${options.url}/`;
    this.headers = {};
    if (options.username !== undefined) {
      this.headers['Authorization'] = `Basic ${btoa(unescape(encodeURIComponent(`${options.username}:${options.password ?? ''}`)))}`;
    }
  }

  /** Creates the calendar if it doesn't exist. Returns true if it was created. */
  async ensureCalendar(displayName: string): Promise<boolean> {
    const found = await this.request('PROPFIND', this.url, { Depth: '0' });
    if (found.status === 207 || found.status === 200) return false;
    if (found.status !== 404) throw this.failure(found, 'look up the calendar');
    const body =
      '<?xml version="1.0" encoding="utf-8"?><D:mkcol xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop>' +
      `<D:resourcetype><D:collection/><C:calendar/></D:resourcetype><D:displayname>${xml(displayName)}</D:displayname>` +
      '</D:prop></D:set></D:mkcol>';
    const created = await this.request('MKCOL', this.url, { 'Content-Type': 'application/xml; charset=utf-8' }, body);
    if (created.status !== 201) throw this.failure(created, 'create the calendar');
    return true;
  }

  /** Every event in the calendar, with its content. */
  async list(): Promise<RemoteEvent[]> {
    const body =
      '<?xml version="1.0" encoding="utf-8"?><C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">' +
      '<D:prop><D:getetag/><C:calendar-data/></D:prop><C:filter><C:comp-filter name="VCALENDAR"/></C:filter></C:calendar-query>';
    const response = await this.request('REPORT', this.url, { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }, body);
    if (response.status !== 207) throw this.failure(response, 'list the events');
    const text = await response.text();
    return [...text.matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/g)].flatMap(([, part = '']) => {
      const href = tag(part, 'href');
      const data = tag(part, 'calendar-data');
      if (href === null || data === null) return [];
      const name = decodeURIComponent(href.replace(/\/+$/, '').split('/').at(-1) ?? '');
      return [{ name, etag: tag(part, 'getetag'), data }];
    });
  }

  /** Puts an event: `etag` null means it must not exist yet, otherwise it must still have that ETag. */
  async put(name: string, data: string, etag: string | null): Promise<void> {
    const precondition: Record<string, string> = etag === null ? { 'If-None-Match': '*' } : { 'If-Match': etag };
    const response = await this.request('PUT', this.url + encodeURIComponent(name), { 'Content-Type': 'text/calendar; charset=utf-8', ...precondition }, data);
    if (response.status === 412) throw new CalDavError(`${name} changed on the server during the sync; run sword sync again`);
    if (response.status !== 201 && response.status !== 204 && response.status !== 200) throw this.failure(response, `upload ${name}`);
  }

  async delete(name: string, etag: string | null): Promise<void> {
    const response = await this.request('DELETE', this.url + encodeURIComponent(name), etag === null ? {} : { 'If-Match': etag });
    if (response.status === 412) throw new CalDavError(`${name} changed on the server during the sync; run sword sync again`);
    if (response.status !== 200 && response.status !== 204 && response.status !== 404) throw this.failure(response, `delete ${name}`);
  }

  private async request(method: string, url: string, headers: Record<string, string>, body?: string): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(url, { method, headers: { ...this.headers, ...headers }, ...(body !== undefined && { body }) });
    } catch (error) {
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      throw new CalDavError(`could not reach ${this.url}: ${cause?.code ?? cause?.message ?? (error as Error).message}`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new CalDavError(`${this.url} refused the login (${response.status}); check caldav.username in sword.yaml and SWORD_CALDAV_PASSWORD`);
    }
    return response;
  }

  private failure(response: Response, action: string): CalDavError {
    return new CalDavError(`could not ${action} at ${this.url}: the server answered ${response.status} ${response.statusText}`);
  }
}

/** The text of the first element with this local name, unescaped. */
function tag(xmlText: string, name: string): string | null {
  const match = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${name}>`).exec(xmlText);
  if (!match) return null;
  const raw = match[1] ?? '';
  const cdata = /^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/.exec(raw);
  if (cdata) return cdata[1] ?? '';
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
