/**
 * Tests for the extra handshake headers of GluesyncClient.
 */

import * as fs from 'fs-extra';
import { GluesyncClient } from '../src/client';

jest.mock('fs-extra');

describe('GluesyncClient extra headers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    (fs.readFileSync as jest.Mock).mockReturnValue('mock-license-content');
  });

  it('sends only the license and the tag without extra headers', () => {
    const client = new GluesyncClient({ moduleTag: 'conductor' });

    expect(client.getConnectionHeaders()).toEqual({
      'Module-License': 'mock-license-content',
      'Module-Tag': 'conductor',
    });
  });

  it('adds static extra headers', () => {
    const client = new GluesyncClient({
      moduleTag: 'conductor',
      extraHeaders: { 'Module-Environment': 'conductor-docker' },
    });

    expect(client.getConnectionHeaders()).toEqual({
      'Module-Environment': 'conductor-docker',
      'Module-License': 'mock-license-content',
      'Module-Tag': 'conductor',
    });
  });

  it('asks a function again on every connection', () => {
    const values = ['conductor-docker', 'conductor-swarm'];
    const client = new GluesyncClient({
      moduleTag: 'conductor',
      extraHeaders: () => ({ 'Module-Environment': values.shift() ?? '' }),
    });

    expect(client.getConnectionHeaders()['Module-Environment']).toBe(
      'conductor-docker',
    );
    expect(client.getConnectionHeaders()['Module-Environment']).toBe(
      'conductor-swarm',
    );
    // Empty values are left out
    expect(client.getConnectionHeaders()).not.toHaveProperty(
      'Module-Environment',
    );
  });

  it('never lets extra headers replace the license or the tag', () => {
    const client = new GluesyncClient({
      moduleTag: 'conductor',
      extraHeaders: { 'Module-Tag': 'other', 'Module-License': 'forged' },
    });

    expect(client.getConnectionHeaders()).toEqual({
      'Module-License': 'mock-license-content',
      'Module-Tag': 'conductor',
    });
  });

  it('connects without extra headers when the function throws', () => {
    const client = new GluesyncClient({
      moduleTag: 'conductor',
      extraHeaders: () => {
        throw new Error('engine not reachable');
      },
    });

    expect(client.getConnectionHeaders()).toEqual({
      'Module-License': 'mock-license-content',
      'Module-Tag': 'conductor',
    });
  });
});
