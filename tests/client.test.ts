/**
 * Tests for the GluesyncClient class.
 */

import * as fs from 'fs-extra';
import { GluesyncClient } from '../src/client';
import { WebSocketConnection } from '../src/connection';
import * as discovery from '../src/discovery';
import * as utils from '../src/utils';
import {
  GluesyncConnectionError,
  GluesyncAuthenticationError,
  GluesyncLicenseError,
  GluesyncSSLError
} from '../src/exceptions';

// Mock dependencies
jest.mock('fs-extra');
jest.mock('../src/connection');
jest.mock('../src/discovery');
jest.mock('../src/utils');

describe('GluesyncClient', () => {
  let client: GluesyncClient;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock fs.existsSync to return true for license file
    (fs.existsSync as jest.Mock).mockReturnValue(true);
    
    // Mock fs.readFileSync to return a mock license content
    (fs.readFileSync as jest.Mock).mockReturnValue('mock-license-content');
    
    // Mock getCorehubAddress to return a mock address
    (discovery.getCorehubAddress as jest.Mock).mockResolvedValue('192.168.1.100');
    
    // Mock createSslContextFromJks to return mock SSL options
    (utils.createSslContextFromJks as jest.Mock).mockResolvedValue({
      ca: 'mock-ca',
      cert: 'mock-cert',
      key: 'mock-key'
    });
    
    // Mock WebSocketConnection.connect to return a mock token
    (WebSocketConnection.prototype.connect as jest.Mock).mockResolvedValue('jwt-token-123');
    
    // Create client instance
    client = new GluesyncClient({
      host: 'localhost',
      port: 1717,
      licenseFilePath: 'gs-license.dat',
      moduleTag: 'test-module'
    });
  });
  
  test('should initialize with correct parameters', () => {
    expect(client).toBeDefined();
    expect(client.isConnected).toBe(false);
    expect(client.token).toBeNull();
    expect(client.connectionStatus).toBe('Not initialized');
  });
  
  test('should connect successfully with explicit host', async () => {
    // Connect to the server
    const token = await client.connect();
    
    // Verify that WebSocketConnection was created with correct parameters
    expect(WebSocketConnection).toHaveBeenCalledWith(
      'localhost',
      1717,
      expect.objectContaining({
        'Module-License': 'mock-license-content',
        'Module-Tag': 'test-module'
      }),
      null,
      1000,
      10000
    );
    
    // Verify that WebSocketConnection.connect was called
    expect(WebSocketConnection.prototype.connect).toHaveBeenCalled();
    
    // Verify the token
    expect(token).toBe('jwt-token-123');
    expect(client.token).toBe('jwt-token-123');
    expect(client.connectionStatus).toBe('Connected');
  });
  
  test('should use autodiscovery when host is null', async () => {
    // Create client with null host
    client = new GluesyncClient({
      host: null,
      port: 1717,
      licenseFilePath: 'gs-license.dat',
      moduleTag: 'test-module'
    });
    
    // Connect to the server
    await client.connect();
    
    // Verify that getCorehubAddress was called
    expect(discovery.getCorehubAddress).toHaveBeenCalledWith(
      'CORE_HUB_ADDRESS',
      1717,
      10,
      10000
    );
    
    // Verify that WebSocketConnection was created with the discovered host
    expect(WebSocketConnection).toHaveBeenCalledWith(
      '192.168.1.100',
      1717,
      expect.any(Object),
      null,
      1000,
      10000
    );
  });
  
  test('should set up SSL context when ssl=true', async () => {
    // Create client with SSL enabled
    client = new GluesyncClient({
      host: 'localhost',
      port: 1717,
      licenseFilePath: 'gs-license.dat',
      moduleTag: 'test-module',
      ssl: true,
      keystorePath: 'keystore.jks',
      keystorePassword: 'password'
    });
    
    // Set environment variables for keystore
    process.env.KEYSTORE_PATH = 'keystore.jks';
    process.env.KEYSTORE_PASSWORD = 'password';
    
    // Connect to the server
    await client.connect();
    
    // Verify that createSslContextFromJks was called
    expect(utils.createSslContextFromJks).toHaveBeenCalledWith(
      'keystore.jks',
      'password'
    );
    
    // Verify that WebSocketConnection was created with SSL options
    expect(WebSocketConnection).toHaveBeenCalledWith(
      'localhost',
      1717,
      expect.any(Object),
      {
        ca: 'mock-ca',
        cert: 'mock-cert',
        key: 'mock-key'
      },
      1000,
      10000
    );
    
    // Clean up environment variables
    delete process.env.KEYSTORE_PATH;
    delete process.env.KEYSTORE_PASSWORD;
  });
  
  test('should handle license file errors', async () => {
    // Mock fs.existsSync to return false for license file
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    
    // Expect connect to throw a license error
    await expect(client.connect()).rejects.toThrow(GluesyncLicenseError);
  });
  
  test('should handle SSL errors', async () => {
    // Create client with SSL enabled
    client = new GluesyncClient({
      host: 'localhost',
      port: 1717,
      licenseFilePath: 'gs-license.dat',
      moduleTag: 'test-module',
      ssl: true,
      keystorePath: 'keystore.jks',
      keystorePassword: 'password'
    });
    
    // Mock createSslContextFromJks to throw an error
    (utils.createSslContextFromJks as jest.Mock).mockRejectedValue(
      new Error('SSL error')
    );
    
    // Expect connect to throw an SSL error
    await expect(client.connect()).rejects.toThrow(GluesyncSSLError);
  });
  
  test('should handle connection errors', async () => {
    // Mock WebSocketConnection.connect to throw an error
    (WebSocketConnection.prototype.connect as jest.Mock).mockRejectedValue(
      new GluesyncConnectionError('Connection failed')
    );
    
    // Expect connect to throw a connection error
    await expect(client.connect()).rejects.toThrow(GluesyncConnectionError);
  });
  
  test('should handle authentication errors', async () => {
    // Mock WebSocketConnection.connect to throw an authentication error
    (WebSocketConnection.prototype.connect as jest.Mock).mockRejectedValue(
      new GluesyncAuthenticationError('Authentication failed')
    );
    
    // Expect connect to throw an authentication error
    await expect(client.connect()).rejects.toThrow(GluesyncAuthenticationError);
  });
  
  test('should disconnect successfully', async () => {
    // First connect
    await client.connect();
    
    // Then disconnect
    await client.disconnect();
    
    // Verify that WebSocketConnection.disconnect was called
    expect(WebSocketConnection.prototype.disconnect).toHaveBeenCalled();
  });
  
  test('should emit events and call callbacks', async () => {
    // Set up event handlers
    const onConnected = jest.fn();
    const onDisconnected = jest.fn();
    const onError = jest.fn();
    
    client.onConnected = onConnected;
    client.onDisconnected = onDisconnected;
    client.onError = onError;
    
    // Set up event listeners
    const connectedListener = jest.fn();
    const disconnectedListener = jest.fn();
    const errorListener = jest.fn();
    
    client.on('connected', connectedListener);
    client.on('disconnected', disconnectedListener);
    client.on('error', errorListener);
    
    // Connect
    await client.connect();
    
    // Get the connection event handlers
    const connectionInstance = (WebSocketConnection as jest.Mock).mock.instances[0];
    const connectionOnConnected = connectionInstance.onConnected;
    const connectionOnDisconnected = connectionInstance.onDisconnected;
    const connectionOnError = connectionInstance.onError;
    
    // Simulate connection events
    await connectionOnConnected('jwt-token-123');
    await connectionOnDisconnected('Test disconnection');
    await connectionOnError(new Error('Test error'));
    
    // Verify that callbacks were called
    expect(onConnected).toHaveBeenCalledWith('jwt-token-123');
    expect(onDisconnected).toHaveBeenCalledWith('Test disconnection');
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    
    // Verify that event listeners were called
    expect(connectedListener).toHaveBeenCalledWith('jwt-token-123');
    expect(disconnectedListener).toHaveBeenCalledWith('Test disconnection');
    expect(errorListener).toHaveBeenCalledWith(expect.any(Error));
  });
});
