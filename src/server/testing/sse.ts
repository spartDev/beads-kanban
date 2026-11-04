import { request, type IncomingHttpHeaders } from 'node:http';

/** Un flux d'événements serveur ouvert par un test, lu comme le ferait un navigateur. */
export interface Stream {
  status: number;
  headers: IncomingHttpHeaders;
  /** Le corps reçu jusqu'ici. */
  received(): string;
  /** Résout dès que le corps reçu correspond à `pattern`, échoue au bout de `timeoutMs`. */
  waitFor(pattern: string | RegExp, timeoutMs?: number): Promise<string>;
  /** Résolu quand le serveur termine le flux, ou que la connexion se ferme. */
  closed: Promise<void>;
  close(): void;
}

/**
 * Ouvre `GET path` en demandant `text/event-stream` et rend la main dès les en-têtes reçus. `headers.host` remplace
 * l'en-tête Host (ce que `fetch` ne laisse pas faire), pour éprouver le contrôle contre le DNS rebinding.
 */
export function openStream(port: number, path: string, headers: Record<string, string> = {}): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, setHost: !('host' in headers), headers: { accept: 'text/event-stream', ...headers } },
      (res) => {
        let body = '';
        const waiters = new Set<() => void>();
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
          for (const wake of [...waiters]) wake();
        });
        res.on('error', () => undefined); // la connexion coupée par le test
        const closed = new Promise<void>((done) => {
          res.on('end', done);
          res.on('close', done);
        });
        const matches = (pattern: string | RegExp) => (typeof pattern === 'string' ? body.includes(pattern) : pattern.test(body));
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          received: () => body,
          closed,
          close: () => req.destroy(),
          waitFor: (pattern, timeoutMs = 3_000) =>
            new Promise((found, fail) => {
              const check = () => {
                if (!matches(pattern)) return;
                clearTimeout(timer);
                waiters.delete(check);
                found(body);
              };
              const timer = setTimeout(() => {
                waiters.delete(check);
                fail(new Error(`« ${String(pattern)} » n'est pas arrivé en ${timeoutMs} ms. Reçu : ${JSON.stringify(body)}`));
              }, timeoutMs);
              waiters.add(check);
              check();
            }),
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}
