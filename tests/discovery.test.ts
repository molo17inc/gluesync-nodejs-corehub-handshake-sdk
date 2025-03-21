/**
 * Tests for the discovery module.
 */

import * as dgram from 'dgram';
import { CoreHubDiscovery, getCorehubAddress } from '../src/discovery';

// Mock the dgram module
jest.mock('dgram', () => {
  const mockSocket = {
    on: jest.fn().mockReturnThis(),
    once: jest.fn().mockReturnThis(),
    bind: jest.fn().mockReturnThis(),
    setBroadcast: jest.fn().mockReturnThis(),
    close: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    addMembership: jest.fn().mockReturnThis()
  };
  
  return {
    createSocket: jest.fn(() => mockSocket)
  };
});

describe('CoreHubDiscovery', () => {
  let discovery: CoreHubDiscovery;
  let mockSocket: any;
  
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Set up fake timers
    jest.useFakeTimers();
    
    // Create a mock socket
    mockSocket = {
      on: jest.fn().mockReturnThis(),
      once: jest.fn().mockReturnThis(),
      bind: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      close: jest.fn().mockReturnThis(),
      setBroadcast: jest.fn().mockReturnThis(),
      addMembership: jest.fn().mockReturnThis(),
      address: jest.fn().mockReturnValue({ port: 1717 })
    };
    
    // Mock dgram.createSocket to return our mock socket
    (dgram.createSocket as jest.Mock).mockReturnValue(mockSocket);
    
    // Set up mock response for CI environment
    if (process.env.CI) {
      // Mock a response from the CoreHub service
      mockSocket.on.mockImplementation((event: string, callback: (...args: any[]) => void) => {
        if (event === 'message') {
          // Simulate a message from CoreHub
          setTimeout(() => {
            callback(Buffer.from(JSON.stringify({
              host: 'corehub',
              port: 1717
            })), { address: 'corehub', port: 1717 });
          }, 100);
        }
        return mockSocket;
      });
    }
    
    // Create discovery instance with a longer timeout to avoid test failures
    discovery = new CoreHubDiscovery(1717, 10, 30000);
  });
  
  afterEach(() => {
    // Restore real timers
    jest.useRealTimers();
  });
  
  test('should create a UDP socket', () => {
    // Create a new instance to ensure the mock is called
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    discovery = new CoreHubDiscovery(1717, 10, 30000);
    // Verify that createSocket was called
    expect(dgram.createSocket).toHaveBeenCalled();
  });
  
  test('should set up socket event handlers', () => {
    // Create a new instance to ensure the mock is called
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    discovery = new CoreHubDiscovery(1717, 10, 30000);
    // Verify that the event handlers were set up
    expect(mockSocket.on).toHaveBeenCalled();
  });
  
  test('should bind socket when discover is called', async () => {
    // Increase the timeout for this test
    jest.setTimeout(30000);
    
    // Reset mocks
    jest.clearAllMocks();
    // Mock the socket to emit 'listening' event when bind is called
    mockSocket.bind.mockImplementation((options: any, callback: any) => {
      if (callback) callback();
      return mockSocket;
    });
    
    // Mock socket.send to simulate sending the discovery message
    mockSocket.send.mockImplementation((msg: any, offset: any, length: any, port: any, address: any, callback: any) => {
      if (callback) callback(null);
      return mockSocket;
    });
    
    // We'll simulate receiving a response after a short delay
    
    // Set up a mock implementation for the 'message' event
    const messageHandlers = mockSocket.on.mock.calls.filter(
      (call: any) => call[0] === 'message'
    );
    
    // Simulate receiving a response after a short delay
    setTimeout(() => {
      // Find the message handler if it exists
      if (messageHandlers && messageHandlers.length > 0) {
        const messageHandler = messageHandlers[0][1];
        const mockMessage = Buffer.from('COREHUB_DISCOVERY_RESPONSE:192.168.1.100');
        messageHandler(mockMessage, { address: '192.168.1.100' });
      }
    }, 100);
    
    // Call the discover method
    const discoverPromise = discovery.discoverCoreHub();
    
    // Wait for the discovery to complete
    const result = await discoverPromise;
    
    // Verify the result
    expect(result).toBe('192.168.1.100');
    
    // Verify that the socket was bound
    expect(mockSocket.bind).toHaveBeenCalled();
    
    // Verify that setBroadcast was called
    expect(mockSocket.setBroadcast).toHaveBeenCalledWith(true);
    
    // Verify that the discovery message was sent
    expect(mockSocket.send).toHaveBeenCalledWith(
      expect.any(Buffer),
      0,
      expect.any(Number),
      expect.any(Number),
      '255.255.255.255',
      expect.any(Function)
    );
    
    // Verify that the socket was closed
    expect(mockSocket.close).toHaveBeenCalled();
  });
  
  test('should handle errors during discovery', async () => {
    // Increase the timeout for this test
    jest.setTimeout(30000);
    
    // Reset mocks
    jest.clearAllMocks();
    // Mock the socket to emit 'listening' event when bind is called
    mockSocket.bind.mockImplementation((options: any, callback: any) => {
      if (callback) callback();
      return mockSocket;
    });
    
    // Mock socket.send to simulate an error
    mockSocket.send.mockImplementation((msg: any, offset: any, length: any, port: any, address: any, callback: any) => {
      if (callback) callback(new Error('Network error'));
      return mockSocket;
    });
    
    // Call the discover method and expect it to reject
    await expect(discovery.discoverCoreHub()).rejects.toThrow('Network error');
    
    // Verify that the socket was closed
    expect(mockSocket.close).toHaveBeenCalled();
  });
});

describe('getCorehubAddress', () => {
  beforeEach(() => {
    // Reset environment variables
    delete process.env.CORE_HUB_ADDRESS;
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock CoreHubDiscovery.discoverCoreHub
    jest.spyOn(CoreHubDiscovery.prototype, 'discoverCoreHub').mockResolvedValue('192.168.1.100');
  });
  
  test('should return address from environment variable if set', async () => {
    // Set environment variable
    process.env.CORE_HUB_ADDRESS = '10.0.0.1';
    
    // Call getCorehubAddress
    const address = await getCorehubAddress('CORE_HUB_ADDRESS', 1717, 10, 5000);
    
    // Verify the result
    expect(address).toBe('10.0.0.1');
    
    // Verify that discoverCoreHub was not called
    expect(CoreHubDiscovery.prototype.discoverCoreHub).not.toHaveBeenCalled();
  });
  
  test('should discover address if environment variable is not set', async () => {
    // Call getCorehubAddress
    const address = await getCorehubAddress('CORE_HUB_ADDRESS', 1717, 10, 5000);
    
    // Verify the result
    expect(address).toBe('192.168.1.100');
    
    // Verify that discoverCoreHub was called
    expect(CoreHubDiscovery.prototype.discoverCoreHub).toHaveBeenCalled();
  });
});
