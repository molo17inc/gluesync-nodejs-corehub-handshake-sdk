/**
 * This file is part of Gluesync SDK.
 *
 * Gluesync SDK is dual-licensed under the following licenses:
 *
 * 1. GNU General Public License (GPL) Version 3
 *    You may use, modify, and distribute this software under the terms of the GPL v3.
 *    See the LICENSE-GPL file or <http://www.gnu.org/licenses/gpl-3.0.html> for details.
 *    This option is available at no cost, but any derivative works must also be licensed under GPL v3.
 *
 * 2. MOLO17 Commercial License
 *    Alternatively, you may use this software under the MOLO17 Commercial License,
 *    which includes a warranty and permits proprietary use. Contact MOLO17 at info@molo17.com
 *    for licensing terms and conditions.
 *
 * You must choose one of these licenses to use this software. Using this software implies
 * acceptance of one of these licenses. See the accompanying LICENSE files or contact
 * MOLO17 for more information.
 *
 * Copyright (C) 2025 MOLO17. All rights reserved.
 */

import * as fs from 'fs-extra';
import * as tls from 'tls';
import { EventEmitter } from 'events';
import {
  WebSocketConnection,
  CallbackFunction,
  DEFAULT_PONG_TIMEOUT_MS,
} from './connection';
import { createSslContext, loadCredentials } from './utils';
import { getCorehubAddress } from './discovery';
import {
  GluesyncClosedError,
  GluesyncConnectionError,
  // GluesyncAuthenticationError,
  GluesyncLicenseError,
  GluesyncSSLError,
} from './exceptions';
import debugTZ from './debugTZ';

// Set up debug logger
const log = debugTZ('gluesync:client');

/**
 * Main client for interacting with Gluesync CoreHub services.
 * Manages the connection, authentication, and WebSocket communication with the CoreHub.
 */
export class GluesyncClient extends EventEmitter {
  // Host given by the caller, never overwritten: a DNS name keeps resolving to
  // CoreHub's current address, while a discovered address goes stale when the
  // CoreHub container is recreated.
  private readonly configuredHost: string | null;
  // Host of the last successful connection (configured or discovered)
  private host: string | null;
  private port: number;
  private moduleTag: string;
  private useSSL: boolean;
  private verifySsl: boolean;
  private pingInterval: number;
  private timeout: number;
  private pongTimeout: number;
  private discoveryStartPort: number;
  private discoveryPortRange: number;

  private licenseFilePath: string;

  private sslOptions: tls.ConnectionOptions | null = null;
  private connection: WebSocketConnection | null = null;
  private _token: string | null = null;

  // Reconnection state
  private _reconnecting: boolean = false;
  private _connecting: boolean = false;
  private _reconnectTimer: NodeJS.Timeout | null = null;
  private _initialReconnectDelay: number = 1000; // 1 second
  private _maxReconnectDelay: number = 30000; // 30 seconds
  private _reconnectBackoffMultiplier: number = 2; // Double each time for exponential backoff
  private _reconnectAttempts: number = 0;
  private _cycleCount: number = 0; // Track backoff cycles
  private _stopped: boolean = false; // Set by disconnect(), cleared by connect()

  /**
   * Initialize the Gluesync client.
   *
   * @param options - Client configuration options
   * @param options.host - Hostname or IP address of the CoreHub (null for autodiscovery)
   * @param options.port - Port number for the CoreHub WebSocket
   * @param options.licenseFilePath - Path to the gs-license.dat file
   * @param options.moduleTag - Name/tag for this module
   * @param options.ssl - Whether to use SSL/TLS for the connection
   * @param options.pingInterval - Interval in milliseconds between ping messages
   * @param options.timeout - Connection timeout in milliseconds
   * @param options.pongTimeout - Reconnect when nothing arrives from CoreHub for
   *   this many milliseconds (0 disables the check)
   * @param options.discoveryStartPort - Base port for UDP discovery
   * @param options.discoveryPortRange - Number of ports to scan for UDP discovery
   */
  constructor({
    host = null,
    port = 1717,
    licenseFilePath = 'gs-license.dat',
    moduleTag = 'nodejs-module',
    ssl = false,
    verifySsl = true,
    pingInterval = 1000,
    timeout = 10000,
    pongTimeout = DEFAULT_PONG_TIMEOUT_MS,
    discoveryStartPort = 1717,
    discoveryPortRange = 10,
  }: {
    host?: string | null;
    port?: number;
    licenseFilePath?: string;
    moduleTag?: string;
    ssl?: boolean;
    verifySsl?: boolean;
    pingInterval?: number;
    timeout?: number;
    pongTimeout?: number;
    discoveryStartPort?: number;
    discoveryPortRange?: number;
  } = {}) {
    super();

    this.configuredHost = host;
    this.host = host;
    this.port = port;
    this.moduleTag = moduleTag;
    this.useSSL = ssl;
    this.verifySsl = verifySsl;
    this.pingInterval = pingInterval;
    this.timeout = timeout;
    this.pongTimeout = pongTimeout;
    this.discoveryStartPort = discoveryStartPort;
    this.discoveryPortRange = discoveryPortRange;
    this.licenseFilePath = licenseFilePath;

    // Event handlers
    this._onConnected = this._onConnected.bind(this);
    this._onDisconnected = this._onDisconnected.bind(this);
    this._onError = this._onError.bind(this);

    // SSL context setup
    if (this.useSSL) {
      // We'll initialize the SSL context when connecting to avoid
      // blocking the constructor with async operations

      log('SSL will be used for connection');
    }

    log('GluesyncClient initialized for %s:%d', host || 'autodiscovery', port);
  }

  /**
   * Get the JWT token received from CoreHub after authentication.
   *
   * @returns The JWT token as a string, or null if not authenticated
   */
  public get token(): string | null {
    if (this.connection && this.connection.token) {
      return this.connection.token;
    }
    return this._token;
  }

  /**
   * Get the current connection status.
   *
   * @returns String describing the connection status
   */
  public get connectionStatus(): string {
    if (!this.connection) {
      return 'Not initialized';
    }

    if (this.connection.isConnected) {
      return 'Connected';
    }

    return 'Disconnected';
  }

  /**
   * Check if the client is currently connected to CoreHub.
   *
   * @returns True if connected, False otherwise
   */
  public get isConnected(): boolean {
    return (
      this._connected &&
      this.connection !== null &&
      this.connection.isConnected === true
    );
  }

  /**
   * Set the connected state
   */
  private _connected: boolean = false;

  /**
   * Event handler for connected events.
   * Set this to receive notifications when the client connects.
   */
  public onConnected: CallbackFunction<string> | null = null;

  /**
   * Event handler for disconnected events.
   * Set this to receive notifications when the client disconnects.
   */
  public onDisconnected: CallbackFunction<string> | null = null;

  /**
   * Event handler for error events.
   * Set this to receive notifications when an error occurs.
   */
  public onError: CallbackFunction<Error> | null = null;

  /**
   * Event handler for token update events.
   * Set this to receive notifications when the authentication token changes,
   * which happens both on initial connection and after reconnection.
   */
  public onTokenUpdated: CallbackFunction<string> | null = null;

  /**
   * Event handler for reconnecting events.
   * Set this to receive notifications when the client is attempting to reconnect.
   */
  public onReconnecting: CallbackFunction<void> | null = null;

  /**
   * Event handler for reconnected events.
   * Set this to receive notifications when the client has successfully reconnected.
   */
  public onReconnected: CallbackFunction<string> | null = null;

  /**
   * Generate the HTTP headers for the WebSocket connection.
   *
   * @returns Dictionary of HTTP headers
   * @throws GluesyncLicenseError if the license file cannot be read
   */
  public getConnectionHeaders(): Record<string, string> {
    return {
      'Module-License': this.getLicenseContent(),
      'Module-Tag': this.moduleTag,
    };
  }

  /**
   * Connect to the CoreHub and perform the handshake authentication.
   *
   * If a host was not explicitly provided in constructor, this method will
   * attempt to discover the CoreHub on the local network before connecting.
   * Retries indefinitely with exponential backoff until successful.
   *
   * @returns Promise resolving to the JWT token received from the server
   * @throws GluesyncLicenseError if the license file cannot be read
   * @throws GluesyncSSLError if SSL setup fails
   */
  public async connect(): Promise<string> {
    if (this.isConnected) {
      log('Already connected to CoreHub');
      return this.token!;
    }

    if (this._connecting) {
      log('Connection attempt already in progress');
      throw new GluesyncConnectionError(
        'Connection attempt already in progress',
      );
    }

    this._connecting = true;
    this._stopped = false;

    // Reset connection state
    this._connected = false;

    // Retry logic with exponential backoff
    let retryCount = 0;
    let backoffDelay = 1000; // Start with 1 second
    const maxBackoff = 30000; // Maximum backoff of 30 seconds
    let cycleCount = 0;

    // Retry indefinitely until connected
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        // Use autodiscovery if host is not provided
        let host = this.host;
        if (host === null) {
          try {
            if (retryCount > 0) {
              log(
                'Retry %d (cycle %d) for UDP discovery...',
                retryCount,
                cycleCount,
              );
            } else {
              log(
                'No host provided, using UDP autodiscovery to find CoreHub...',
              );
            }

            host = await getCorehubAddress(
              'CORE_HUB_ADDRESS',
              this.discoveryStartPort,
              this.discoveryPortRange,
              this.timeout,
              this.verifySsl,
            );

            // Save the discovered host
            this.host = host;
            log('CoreHub discovered at %s', host);
          } catch (error) {
            log('Failed to discover CoreHub: %s', error);
            throw new GluesyncConnectionError(
              `Failed to discover CoreHub: ${error}`,
            );
          }
        } else {
          if (retryCount === 0) {
            log('Connecting to CoreHub at %s:%d...', host, this.port);
          } else {
            log(
              'Retry %d (cycle %d) connecting to CoreHub at %s:%d...',
              retryCount,
              cycleCount,
              host,
              this.port,
            );
          }
        }

        if (this.useSSL && !this.sslOptions) {
          try {
            const securityConfigPath = process.env.GLUESYNC_SECURITY_CONFIG;
            const { certPath, keyPath, password } =
              await loadCredentials(securityConfigPath);

            if (!certPath || !keyPath) {
              throw new GluesyncSSLError(
                'Certificate and key paths are required for SSL connections',
              );
            }

            if (!password) {
              throw new GluesyncSSLError(
                'Password are required for SSL connections',
              );
            }

            this.sslOptions = await createSslContext(
              certPath,
              keyPath,
              password,
            );
            log('SSL context created successfully');
          } catch (error) {
            log('Failed to create SSL context: %s', error);
            throw new GluesyncSSLError(
              `Failed to create SSL context: ${error}`,
            );
          }
        }

        // Create the connection and connect to the server
        this.connection = this._createConnection(host);
        const token = await this.connection.connect();
        this._token = token;
        this._connected = true;

        log('Connected to CoreHub at %s:%d', host, this.port);
        this._connecting = false;
        return token;
      } catch (error) {
        // Don't retry for license or SSL errors
        if (
          error instanceof GluesyncLicenseError ||
          error instanceof GluesyncSSLError
        ) {
          log('Fatal error, not retrying: %s', error);
          this._connecting = false;
          throw error;
        }

        if (this._stopped) {
          log('Disconnect requested, not retrying');
          this._connecting = false;
          throw new GluesyncClosedError('Disconnected while connecting');
        }

        // Connection failed, retry with exponential backoff
        retryCount++;
        log('Connection attempt %d failed: %s', retryCount, error);
        log('Waiting %d ms before next retry...', backoffDelay);

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, backoffDelay));

        // Double the backoff for next time, up to the maximum
        backoffDelay = Math.min(backoffDelay * 2, maxBackoff);

        // If we've reached max backoff, reset on the next failure
        if (backoffDelay >= maxBackoff) {
          backoffDelay = 1000; // Reset to 1 second
          cycleCount++;
          log(
            'Completed backoff cycle %d, resetting delay to 1 second',
            cycleCount,
          );
        }
      }
    }
  }

  /**
   * Disconnect from the CoreHub.
   *
   * @throws GluesyncConnectionError if an error occurs during disconnection
   */
  public async disconnect(): Promise<void> {
    // A requested disconnection ends any reconnection in progress and keeps
    // the close of the socket from starting a new one
    this._stopped = true;
    this._reconnecting = false;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    if (!this.isConnected) {
      log('Not connected to CoreHub');
      return;
    }

    // Reset connection state
    this._connected = false;

    try {
      await this.connection!.disconnect();
      log('Disconnected from CoreHub');
    } catch (error) {
      log('Error during disconnection: %s', error);
      throw new GluesyncConnectionError(`Error during disconnection: ${error}`);
    }
  }

  /**
   * Load and get the license content from the file.
   *
   * @returns The license content as a string
   * @throws GluesyncLicenseError if the license file cannot be read
   */
  private getLicenseContent(): string {
    let licenseContent;
    try {
        if (!fs.existsSync(this.licenseFilePath)) {
          throw new GluesyncLicenseError(
            `License file not found: ${this.licenseFilePath}`,
          );
        }

        licenseContent = fs
          .readFileSync(this.licenseFilePath, 'utf8')
          .trim();
      } catch (error) {
        if (error instanceof GluesyncLicenseError) {
          throw error;
        }
        throw new GluesyncLicenseError(`Failed to read license file: ${error}`);
      }

    return licenseContent;
  }

  /**
   * Handle the connected event.
   *
   * @param token - The JWT token received from the server
   */
  private async _onConnected(token: string): Promise<void> {
    log('Connected to CoreHub successfully');
    this._token = token;

    // Emit event
    this.emit('connected', token);

    // Call callback if defined
    if (this.onConnected) {
      try {
        const result = this.onConnected(token);
        if (result instanceof Promise) {
          await result;
        }
      } catch (error) {
        log('Error in onConnected callback: %s', error);
      }
    }

    // Notify about token update on initial connection
    await this._notifyTokenUpdated(token);
  }

  /**
   * Handle the disconnected event.
   *
   * @param reason - The reason for disconnection
   */
  private async _onDisconnected(reason: string): Promise<void> {
    log('Disconnected from CoreHub: %s', reason);

    // Emit event
    this.emit('disconnected', reason);

    // Call callback if defined
    if (this.onDisconnected) {
      try {
        const result = this.onDisconnected(reason);
        if (result instanceof Promise) {
          await result;
        }
      } catch (error) {
        log('Error in onDisconnected callback: %s', error);
      }
    }

    // Start the reconnection process if not already reconnecting
    if (!this._reconnecting && !this._stopped) {
      this._startReconnect();
    }
  }

  /**
   * Handle the error event.
   *
   * @param error - The error that occurred
   */
  private async _onError(error: Error): Promise<void> {
    log('Error in connection: %s', error);

    // Emit event
    this.emit('error', error);

    // Call callback if defined
    if (this.onError) {
      try {
        const result = this.onError(error);
        if (result instanceof Promise) {
          await result;
        }
      } catch (callbackError) {
        log('Error in onError callback: %s', callbackError);
      }
    }

    if (
      !this._reconnecting &&
      !this._connecting &&
      !this._stopped &&
      !this.isConnected
    ) {
      this._startReconnect();
    }
  }

  /**
   * Notify listeners about a token update.
   *
   * @param token - The new token value
   */
  private async _notifyTokenUpdated(token: string): Promise<void> {
    // Only notify if the token actually changed
    if (this._token !== token) {
      log('Token updated');

      // Emit event
      this.emit('tokenUpdated', token);

      // Call callback if defined
      if (this.onTokenUpdated) {
        try {
          const result = this.onTokenUpdated(token);
          if (result instanceof Promise) {
            await result;
          }
        } catch (error) {
          log('Error in onTokenUpdated callback: %s', error);
        }
      }
    }
  }

  /**
   * Start the reconnection process.
   */
  private _startReconnect(): void {
    // Don't start a new reconnection if already reconnecting
    if (this._reconnecting) {
      return;
    }

    // Reset any previous reconnect timer
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }

    this._reconnecting = true;
    this._reconnectAttempts = 0;

    log('Starting reconnection process...');

    // Emit event that we're attempting to reconnect
    this.emit('reconnecting');

    // Call the reconnecting callback if defined
    if (this.onReconnecting) {
      try {
        const result = this.onReconnecting();
        if (result instanceof Promise) {
          result.catch(error => {
            log('Error in onReconnecting callback: %s', error);
          });
        }
      } catch (error) {
        log('Error in onReconnecting callback: %s', error);
      }
    }

    // Schedule the first reconnection attempt
    this._scheduleReconnect();
  }

  /**
   * Schedule a reconnection attempt with exponential backoff.
   * Retries indefinitely until successful.
   */
  private _scheduleReconnect(): void {
    // Increment the reconnect attempts counter
    this._reconnectAttempts++;

    // Calculate the delay with exponential backoff
    const delay = Math.min(
      this._initialReconnectDelay *
        Math.pow(this._reconnectBackoffMultiplier, this._reconnectAttempts - 1),
      this._maxReconnectDelay,
    );

    log(
      'Scheduling reconnection attempt %d (cycle %d) in %d ms...',
      this._reconnectAttempts,
      this._cycleCount,
      delay,
    );

    // Schedule the reconnection
    this._reconnectTimer = setTimeout(() => {
      this._attemptReconnect().catch(error => {
        log('Reconnection attempt failed: %s', error);

        // If we've reached max backoff, reset the delay and increment cycle count
        if (delay >= this._maxReconnectDelay) {
          this._reconnectAttempts = 0; // Reset attempts to restart backoff
          this._cycleCount++;
          log(
            'Completed backoff cycle %d, resetting delay to 1 second',
            this._cycleCount,
          );
        }

        // Always schedule the next attempt (retry indefinitely)
        if (this._reconnecting) {
          this._scheduleReconnect();
        }
      });
    }, delay);
  }

  /**
   * Attempt to reconnect to the CoreHub.
   * First tries the configured host, then the host of the last connection,
   * then re-discovers the CoreHub in case its IP address has changed.
   * Retries indefinitely until successful.
   *
   * @returns The authentication token if reconnection is successful
   */
  private async _attemptReconnect(): Promise<string> {
    log(
      'Attempting to reconnect (attempt %d, cycle %d)...',
      this._reconnectAttempts,
      this._cycleCount,
    );

    try {
      // The configured host goes first: the address of the last connection
      // may have come from discovery and point to a CoreHub that no longer exists
      const knownHosts = [
        ...new Set([this.configuredHost, this.host]),
      ].filter((host): host is string => host !== null);

      for (const host of knownHosts) {
        try {
          log(
            'CoreHub address known (%s), attempting direct reconnection...',
            host,
          );
          return await this._reconnectTo(host);
        } catch (reconnectError) {
          if (reconnectError instanceof GluesyncClosedError) {
            throw reconnectError;
          }
          log('Direct reconnection to %s failed: %s', host, reconnectError);
        }
      }

      if (knownHosts.length > 0) {
        log('CoreHub may have changed IP address, attempting re-discovery...');
      }

      let discoveredHost: string;
      try {
        log('Using UDP autodiscovery to find CoreHub...');
        discoveredHost = await getCorehubAddress(
          'CORE_HUB_ADDRESS',
          this.discoveryStartPort,
          this.discoveryPortRange,
          this.timeout,
          this.verifySsl,
        );
      } catch (discoveryError) {
        log('Failed to discover CoreHub: %s', discoveryError);
        throw new GluesyncConnectionError(
          `Failed to discover CoreHub: ${discoveryError}`,
        );
      }

      if (this.host && this.host !== discoveredHost) {
        log('CoreHub IP changed from %s to %s', this.host, discoveredHost);
      }
      log('CoreHub discovered at %s', discoveredHost);

      return await this._reconnectTo(discoveredHost);
    } catch (error) {
      // Log the error and rethrow
      log('Failed to reconnect: %s', error);
      throw error;
    }
  }

  /**
   * Connect to the given host as part of the reconnection process and
   * notify listeners once connected.
   *
   * @param host - Hostname or IP address of the CoreHub
   * @returns The authentication token received from the server
   */
  private async _reconnectTo(host: string): Promise<string> {
    const connection = this._createConnection(host);
    this.connection = connection;
    const token = await connection.connect();

    // disconnect() was called while this attempt was in flight
    if (this._stopped) {
      await connection.disconnect();
      throw new GluesyncClosedError('Disconnected while reconnecting');
    }

    this.host = host;
    this._token = token;
    this._connected = true;

    // Successfully reconnected
    log('Successfully reconnected to CoreHub at %s:%d', host, this.port);
    this._reconnecting = false;

    // Reset reconnect attempts
    this._reconnectAttempts = 0;

    // Emit reconnected event
    this.emit('reconnected', token);

    // Call the reconnected callback if defined
    if (this.onReconnected) {
      try {
        const result = this.onReconnected(token);
        if (result instanceof Promise) {
          await result;
        }
      } catch (error) {
        log('Error in onReconnected callback: %s', error);
      }
    }

    // Also notify token update listeners when reconnected
    await this._notifyTokenUpdated(token);

    return token;
  }

  /**
   * Create a WebSocket connection to the given host, wired to this client's
   * event handlers.
   *
   * @param host - Hostname or IP address of the CoreHub
   * @returns The new, not yet connected, connection
   */
  private _createConnection(host: string): WebSocketConnection {
    const connection = new WebSocketConnection(
      host,
      this.port,
      this.getConnectionHeaders(),
      this.sslOptions,
      this.pingInterval,
      this.timeout,
      this.verifySsl,
      this.pongTimeout,
    );

    connection.onConnected = this._onConnected;
    connection.onDisconnected = this._onDisconnected;
    connection.onError = this._onError;
    connection.onTokenUpdated = this._notifyTokenUpdated.bind(this);

    return connection;
  }
}
