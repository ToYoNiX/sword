/*
 * A small CalDAV server for tests, behaving like Radicale where it matters:
 * a missing calendar is 404 until MKCOL, items have ETags, preconditions are
 * checked, and stored events come back rewritten (DTSTAMP moved last, LF line
 * endings), so a sync has to compare events, not text.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeCalDav {
  url: string;
  /** Items by name, as stored. */
  items: Map<string, { data: string; etag: string }>;
  exists: boolean;
  requests: string[];
  close(): Promise<void>;
}

export async function fakeCalDav(options: { user?: string; password?: string } = {}): Promise<FakeCalDav> {
  let counter = 0;
  const state: FakeCalDav = { url: '', items: new Map(), exists: false, requests: [], close: async () => {} };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      state.requests.push(`${req.method} ${path}`);
      if (options.user !== undefined) {
        const expected = `Basic ${Buffer.from(`${options.user}:${options.password ?? ''}`).toString('base64')}`;
        if (req.headers.authorization !== expected) return void res.writeHead(401, { 'WWW-Authenticate': 'Basic' }).end();
      }
      const collection = '/assem/sword/';
      const name = path.startsWith(collection) ? path.slice(collection.length) : null;
      if (req.method === 'PROPFIND' && path === collection) return void res.writeHead(state.exists ? 207 : 404).end(state.exists ? '<multistatus xmlns="DAV:"/>' : '');
      if (req.method === 'MKCOL' && path === collection) {
        if (state.exists) return void res.writeHead(405).end();
        state.exists = body.includes('calendar');
        return void res.writeHead(201).end();
      }
      if (!state.exists) return void res.writeHead(404).end();
      if (req.method === 'REPORT' && path === collection) {
        const responses = [...state.items].map(
          ([item, { data, etag }]) =>
            `<response><href>${collection}${encodeURIComponent(item)}</href><propstat><prop><getetag>${etag}</getetag><C:calendar-data>${escape(data)}</C:calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat></response>`,
        );
        return void res.writeHead(207, { 'Content-Type': 'text/xml' }).end(`<?xml version='1.0'?><multistatus xmlns="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">${responses.join('')}</multistatus>`);
      }
      if (name === null || name === '') return void res.writeHead(405).end();
      const current = state.items.get(name);
      if (req.method === 'PUT') {
        if (req.headers['if-none-match'] === '*' && current) return void res.writeHead(412).end();
        if (req.headers['if-match'] !== undefined && req.headers['if-match'] !== current?.etag) return void res.writeHead(412).end();
        state.items.set(name, { data: rewrite(body), etag: `"${++counter}"` });
        return void res.writeHead(current ? 204 : 201, { ETag: `"${counter}"` }).end();
      }
      if (req.method === 'DELETE') {
        if (!current) return void res.writeHead(404).end();
        if (req.headers['if-match'] !== undefined && req.headers['if-match'] !== current.etag) return void res.writeHead(412).end();
        state.items.delete(name);
        return void res.writeHead(200).end();
      }
      res.writeHead(405).end();
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/assem/sword/`;
  state.close = () => new Promise((done) => server.close(() => done()));
  return state;
}

/** As Radicale stores it: LF line endings, DTSTAMP moved to the end of the event. */
function rewrite(ics: string): string {
  const lines = ics.replace(/\r\n/g, '\n').split('\n');
  const stamp = lines.filter((l) => l.startsWith('DTSTAMP'));
  const rest = lines.filter((l) => !l.startsWith('DTSTAMP'));
  const end = rest.indexOf('END:VEVENT');
  rest.splice(end, 0, ...stamp);
  return rest.join('\n');
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** An event that Sword didn't make, e.g. added in a phone's calendar app. */
export const foreignEvent =
  'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Phone//EN\r\nBEGIN:VEVENT\r\nUID:dentist-1\r\nDTSTAMP:20261020T100000Z\r\nDTSTART:20261026T130000Z\r\nDTEND:20261026T140000Z\r\nSUMMARY:Dentist\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
