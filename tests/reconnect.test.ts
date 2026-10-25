/**
 * Reconnection tests against a local WebSocket server that speaks CoreHub's
 * /ext-module protocol: "hello" is answered with a token, "ping" with "pong".
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { GluesyncClient } from '../src/client';
import { WebSocketConnection } from '../src/connection';
import { getCorehubAddress } from '../src/discovery';

jest.mock('../src/discovery', () => ({ getCorehubAddress: jest.fn() }));

// Record the host of every connection the client opens
jest.mock('../src/connection', () => {
  const actual = jest.requireActual('../src/connection');
  class RecordingConnection extends actual.WebSocketConnection {
    static readonly hosts: string[] = [];
    constructor(host: string, ...rest: unknown[]) {
      super(host, ...rest);
      RecordingConnection.hosts.push(host);
    }
  }
  return { ...actual, WebSocketConnection: RecordingConnection };
});

const openedHosts = (): string[] =>
  (WebSocketConnection as unknown as { hosts: string[] }).hosts;

class FakeCoreHub {
  hellos = 0;
  answerPings = true;
  private readonly sockets = new Set<WebSocket>();

  private constructor(private readonly server: WebSocketServer) {
    server.on('connection', socket => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      socket.on('message', data => {
        const message = data.toString();
        if (message === 'hello') {
          this.hellos++;
          socket.send(`token-${this.hellos}`);
        } else if (message === 'ping' && this.answerPings) {
          socket.send('pong');
        }
      });
    });
  }

  static start(port = 0): Promise<FakeCoreHub> {
    return new Promise(resolve => {
      const server: WebSocketServer = new WebSocketServer(
        { port, path: '/ext-module' },
        () => resolve(new FakeCoreHub(server)),
      );
    });
  }

  get port(): number {
    return (this.server.address() as AddressInfo).port;
  }

  dropConnections(): void {
    this.sockets.forEach(socket => socket.terminate());
  }

  stop(): Promise<void> {
    this.dropConnections();
    return new Promise(resolve => this.server.close(() => resolve()));
  }
}

const waitFor = async (
  condition: () => boolean,
  timeoutMs = 5000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('GluesyncClient reconnection', () => {
  let licenseFilePath: string;
  let hubs: FakeCoreHub[];
  let client: GluesyncClient;

  const createClient = (port: number) =>
    new GluesyncClient({
      host: 'localhost',
      port,
      licenseFilePath,
      moduleTag: 'test-module',
      pingInterval: 20,
      pongTimeout: 300,
      timeout: 1000,
    });

  const countEvents = (event: string) => {
    const counter = { count: 0 };
    client.on(event, () => counter.count++);
    return counter;
  };

  beforeAll(() => {
    licenseFilePath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'gluesync-sdk-')),
      'gs-license.dat',
    );
    fs.writeFileSync(licenseFilePath, 'test-license');
  });

  beforeEach(() => {
    hubs = [];
    openedHosts().length = 0;
    (getCorehubAddress as jest.Mock).mockReset();
    (getCorehubAddress as jest.Mock).mockRejectedValue(
      new Error('no broadcast'),
    );
  });

  afterEach(async () => {
    await client?.disconnect();
    await Promise.all(hubs.map(hub => hub.stop()));
  });

  const startHub = async (port = 0) => {
    const hub = await FakeCoreHub.start(port);
    hubs.push(hub);
    return hub;
  };

  it('reconnects when CoreHub stops answering pings', async () => {
    const hub = await startHub();
    client = createClient(hub.port);
    const disconnected = countEvents('disconnected');
    const reconnected = countEvents('reconnected');
    await client.connect();

    // The socket stays open but nothing comes back
    hub.answerPings = false;
    await waitFor(() => disconnected.count === 1);

    hub.answerPings = true;
    await waitFor(() => reconnected.count === 1);
    expect(hub.hellos).toBe(2);
    expect(client.isConnected).toBe(true);
  });

  it('keeps the connection while CoreHub answers pings', async () => {
    const hub = await startHub();
    client = createClient(hub.port);
    const disconnected = countEvents('disconnected');
    await client.connect();

    await sleep(1000);

    expect(disconnected.count).toBe(0);
    expect(hub.hellos).toBe(1);
  });

  it('keeps a healthy connection after the process was paused', async () => {
    const hub = await startHub();
    client = createClient(hub.port);
    const disconnected = countEvents('disconnected');
    await client.connect();

    // Block the event loop for longer than pongTimeout, as a suspended host would
    const resumeAt = Date.now() + 1000;
    while (Date.now() < resumeAt) {
      // busy wait
    }
    await sleep(500);

    expect(disconnected.count).toBe(0);
    expect(hub.hellos).toBe(1);
  });

  it('tries the configured host again after reconnecting to a discovered address', async () => {
    let hub = await startHub();
    const { port } = hub;
    client = createClient(port);
    const reconnected = countEvents('reconnected');
    await client.connect();

    // CoreHub goes away: its name stops answering and discovery finds it
    // again by address once it is back
    (getCorehubAddress as jest.Mock).mockImplementation(async () => {
      hub = await startHub(port);
      return '127.0.0.1';
    });
    await hub.stop();
    await waitFor(() => reconnected.count === 1);
    expect(openedHosts().slice(-1)).toEqual(['127.0.0.1']);

    // On the next drop the configured name comes first again
    (getCorehubAddress as jest.Mock).mockRejectedValue(
      new Error('no broadcast'),
    );
    hub.dropConnections();
    await waitFor(() => reconnected.count === 2);

    expect(openedHosts().slice(-1)).toEqual(['localhost']);
    expect(getCorehubAddress).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect after disconnect()', async () => {
    const hub = await startHub();
    client = createClient(hub.port);
    const reconnecting = countEvents('reconnecting');
    await client.connect();

    await client.disconnect();
    await sleep(1500);

    expect(reconnecting.count).toBe(0);
    expect(hub.hellos).toBe(1);
    expect(openedHosts()).toHaveLength(1);
  });

  it('stops a reconnection in progress on disconnect()', async () => {
    const hub = await startHub();
    const { port } = hub;
    client = createClient(port);
    const reconnecting = countEvents('reconnecting');
    await client.connect();

    await hub.stop();
    await waitFor(() => reconnecting.count === 1);
    await client.disconnect();

    const restarted = await startHub(port);
    await sleep(2500);

    expect(restarted.hellos).toBe(0);
    expect(client.isConnected).toBe(false);
  });
});
