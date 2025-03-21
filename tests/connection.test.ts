/**
 * Tests for the WebSocketConnection class.
 */

import * as WebSocket from 'ws';
import { EventEmitter } from 'events';
import { WebSocketConnection } from '../src/connection';
import {
  GluesyncConnectionError,
  GluesyncAuthenticationError,
  GluesyncTimeoutError
} from '../src/exceptions';

// Mock the WebSocket module
jest.mock('ws', () => {
  const EventEmitter = require('events');
  
  // Create a mock WebSocket class that extends EventEmitter
  class MockWebSocket extends EventEmitter {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    
    readyState: number = MockWebSocket.CONNECTING;
    
    constructor() {
      super();
      // Simulate connection after a short delay
      setTimeout(() => {
        this.readyState = MockWebSocket.OPEN;
        this.emit('open');
      }, 10);
    }
    
    send(data: any, callback?: (err?: Error) => void) {
      if (callback) {
        callback();
      }
      return this;
    }
    
    close() {
      this.readyState = MockWebSocket.CLOSED;
      this.emit('close', 1000, 'Normal closure');
      return this;
    }
  }
  
  return {
    __esModule: true,
    default: MockWebSocket,
    ...MockWebSocket
  };
});

describe('WebSocketConnection', () => {
  let connection: WebSocketConnection;
  let mockWebSocket: any;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create connection instance
    connection = new WebSocketConnection(
      'localhost',
      1717,
      { 'Module-License': 'test-license', 'Module-Tag': 'test-module' },
      null,
      1000,
      1000
    );
    
    // Spy on WebSocket constructor
    jest.spyOn(WebSocket.prototype, 'send').mockImplementation(
      function(this: any, data: any, callback?: (err?: Error) => void) {
        if (callback) callback();
        
        // If the message is 'hello', simulate a token response
        if (data === 'hello') {
          setTimeout(() => {
            this.emit('message', 'jwt-token-123');
          }, 10);
        }
        
        return this;
      }
    );
    
    // Store the mock WebSocket instance
    mockWebSocket = WebSocket;
  });
  
  test('should initialize with correct parameters', () => {
    expect(connection).toBeDefined();
    expect(connection.isConnected).toBe(false);
    expect(connection.token).toBeNull();
    expect(connection.connectionUrl).toBe('ws://localhost:1717/ext-module');
  });
  
  test('should connect successfully and receive token', async () => {
    // Connect to the server
    const token = await connection.connect();
    
    // Verify the token
    expect(token).toBe('jwt-token-123');
    expect(connection.isConnected).toBe(true);
    expect(connection.token).toBe('jwt-token-123');
  });
  
  test('should handle connection errors', async () => {
    // Mock WebSocket to throw an error on connection
    jest.spyOn(WebSocket.prototype, 'on').mockImplementation(
      function(this: any, event: string, listener: (...args: any[]) => void) {
        if (event === 'open') {
          // Don't emit open, emit error instead
          setTimeout(() => {
            this.emit('error', new Error('Connection failed'));
          }, 10);
        } else {
          // Register other event listeners normally
          this.on(event, listener);
        }
        return this;
      }
    );
    
    // Expect connect to throw an error
    await expect(connection.connect()).rejects.toThrow(GluesyncConnectionError);
  });
  
  test('should handle authentication errors', async () => {
    // Mock WebSocket to send an error response instead of a token
    jest.spyOn(WebSocket.prototype, 'send').mockImplementation(
      function(this: any, data: any, callback?: (err?: Error) => void) {
        if (callback) callback();
        
        // If the message is 'hello', simulate a close with authentication error
        if (data === 'hello') {
          setTimeout(() => {
            this.emit('close', 4001, 'Authentication failed');
          }, 10);
        }
        
        return this;
      }
    );
    
    // Expect connect to throw an authentication error
    await expect(connection.connect()).rejects.toThrow(GluesyncAuthenticationError);
  });
  
  test('should handle timeouts', async () => {
    // Create a connection with a very short timeout
    connection = new WebSocketConnection(
      'localhost',
      1717,
      { 'Module-License': 'test-license', 'Module-Tag': 'test-module' },
      null,
      1000,
      1 // 1ms timeout
    );
    
    // Expect connect to throw a timeout error
    await expect(connection.connect()).rejects.toThrow(GluesyncTimeoutError);
  });
  
  test('should disconnect successfully', async () => {
    // First connect
    await connection.connect();
    
    // Then disconnect
    await connection.disconnect();
    
    // Verify the connection state
    expect(connection.isConnected).toBe(false);
    expect(connection.token).toBeNull();
  });
  
  test('should call event handlers', async () => {
    // Set up event handlers
    const onConnected = jest.fn();
    const onDisconnected = jest.fn();
    const onError = jest.fn();
    
    connection.onConnected = onConnected;
    connection.onDisconnected = onDisconnected;
    connection.onError = onError;
    
    // Connect
    await connection.connect();
    
    // Verify that onConnected was called
    expect(onConnected).toHaveBeenCalledWith('jwt-token-123');
    
    // Simulate an error
    const mockWs = WebSocket.prototype as unknown as EventEmitter;
    mockWs.emit('error', new Error('Test error'));
    
    // Verify that onError was called
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    
    // Disconnect
    await connection.disconnect();
    
    // Verify that onDisconnected was called
    expect(onDisconnected).toHaveBeenCalledWith('Disconnected by client');
  });
});
