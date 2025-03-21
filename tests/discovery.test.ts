/**
 * Tests for the discovery module.
 */

import * as dgram from 'dgram';
import { CoreHubDiscovery, getCorehubAddress } from '../src/discovery';

// Mock the dgram module
jest.mock('dgram', () => {
  const mockSocket = {
    on: jest.fn(),
    once: jest.fn(),
    bind: jest.fn(),
    setBroadcast: jest.fn(),
    close: jest.fn(),
    send: jest.fn()
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
    
    // Get the mock socket
    mockSocket = (dgram.createSocket as jest.Mock)();
    
    // Create discovery instance
    discovery = new CoreHubDiscovery(1717, 10, 5000);
  });
  
  test('should create a UDP socket', () => {
    expect(dgram.createSocket).toHaveBeenCalledWith('udp4');
  });
  
  test('should set up socket event handlers', () => {
    expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('message', expect.any(Function));
  });
  
  test('should bind socket when discover is called', async () => {
    // Mock the socket to emit 'listening' event when bind is called
    mockSocket.bind.mockImplementation((options, callback) => {
      if (callback) callback();
      return mockSocket;
    });
    
    // Mock socket.send to simulate sending the discovery message
    mockSocket.send.mockImplementation((msg, offset, length, port, address, callback) => {
      if (callback) callback(null);
      return mockSocket;
    });
    
    // Create a promise that will resolve when the 'message' event handler is called
    const messagePromise = Promise.resolve('192.168.1.100');
    
    // Set up a mock implementation for the 'message' event
    const messageHandlers = mockSocket.on.mock.calls.filter(
      call => call[0] === 'message'
    );
    
    // Simulate receiving a response after a short delay
    setTimeout(() => {
      const messageHandler = messageHandlers[0][1];
      const mockMessage = Buffer.from('COREHUB_DISCOVERY_RESPONSE:192.168.1.100');
      messageHandler(mockMessage, { address: '192.168.1.100' });
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
  
  test('should throw an error if discovery times out', async () => {
    // Mock the socket to emit 'listening' event when bind is called
    mockSocket.bind.mockImplementation((options, callback) => {
      if (callback) callback();
      return mockSocket;
    });
    
    // Mock socket.send to simulate sending the discovery message
    mockSocket.send.mockImplementation((msg, offset, length, port, address, callback) => {
      if (callback) callback(null);
      return mockSocket;
    });
    
    // Set a very short timeout for the test
    discovery = new CoreHubDiscovery(1717, 10, 100);
    
    // Call the discover method and expect it to throw
    await expect(discovery.discoverCoreHub()).rejects.toThrow('CoreHub discovery timed out');
    
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
    jest.spyOn(CoreHubDiscovery.prototype, 'discoverCoreHub')
      .mockImplementation(() => Promise.resolve('192.168.1.100'));
  });
  
  test('should use environment variable if available', async () => {
    // Set environment variable
    process.env.CORE_HUB_ADDRESS = '10.0.0.1';
    
    // Call getCorehubAddress
    const result = await getCorehubAddress('CORE_HUB_ADDRESS', 1717, 10, 5000);
    
    // Verify the result
    expect(result).toBe('10.0.0.1');
    
    // Verify that discoverCoreHub was not called
    expect(CoreHubDiscovery.prototype.discoverCoreHub).not.toHaveBeenCalled();
  });
  
  test('should use discovery if environment variable is not available', async () => {
    // Call getCorehubAddress
    const result = await getCorehubAddress('CORE_HUB_ADDRESS', 1717, 10, 5000);
    
    // Verify the result
    expect(result).toBe('192.168.1.100');
    
    // Verify that discoverCoreHub was called
    expect(CoreHubDiscovery.prototype.discoverCoreHub).toHaveBeenCalled();
  });
});
