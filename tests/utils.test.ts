/**
 * Tests for the utils module.
 */

import * as fs from 'fs-extra';
import * as JSZip from 'jszip';
import * as forge from 'node-forge';
import { 
  createSslContextFromJks,
  createTimeout,
  getErrorFromCloseReason,
  generateRandomId
} from '../src/utils';
import { GluesyncSSLError } from '../src/exceptions';

// Mock dependencies
jest.mock('fs-extra');
jest.mock('jszip');
jest.mock('node-forge');

describe('utils', () => {
  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
  });
  
  describe('createSslContextFromJks', () => {
    beforeEach(() => {
      // Mock fs.readFile to return mock JKS data
      (fs.readFile as jest.Mock).mockResolvedValue(Buffer.from('mock-jks-data'));
      
      // Mock JSZip.loadAsync to return a mock zip object
      const mockZip = {
        files: {
          'certificate.pem': {
            async: jest.fn().mockResolvedValue('mock-certificate')
          },
          'private.key': {
            async: jest.fn().mockResolvedValue('mock-private-key')
          },
          'ca.pem': {
            async: jest.fn().mockResolvedValue('mock-ca')
          }
        }
      };
      (JSZip.loadAsync as jest.Mock).mockResolvedValue(mockZip);
      
      // Mock forge.pki functions
      (forge.pki.certificateFromPem as jest.Mock).mockReturnValue({
        publicKey: 'mock-public-key'
      });
      (forge.pki.privateKeyFromPem as jest.Mock).mockReturnValue('mock-private-key-obj');
      (forge.pki.createCaStore as jest.Mock).mockReturnValue('mock-ca-store');
    });
    
    test('should create SSL context from JKS file', async () => {
      // Call the function
      const sslContext = await createSslContextFromJks('keystore.jks', 'password');
      
      // Verify that fs.readFile was called
      expect(fs.readFile).toHaveBeenCalledWith('keystore.jks');
      
      // Verify that JSZip.loadAsync was called
      expect(JSZip.loadAsync).toHaveBeenCalledWith(Buffer.from('mock-jks-data'));
      
      // Verify the SSL context
      expect(sslContext).toEqual({
        ca: 'mock-ca',
        cert: 'mock-certificate',
        key: 'mock-private-key'
      });
    });
    
    test('should handle file read errors', async () => {
      // Mock fs.readFile to throw an error
      (fs.readFile as jest.Mock).mockRejectedValue(new Error('File not found'));
      
      // Expect the function to throw an SSL error
      await expect(createSslContextFromJks('keystore.jks', 'password'))
        .rejects.toThrow(GluesyncSSLError);
    });
    
    test('should handle invalid JKS format', async () => {
      // Mock JSZip.loadAsync to throw an error
      (JSZip.loadAsync as jest.Mock).mockRejectedValue(new Error('Invalid zip format'));
      
      // Expect the function to throw an SSL error
      await expect(createSslContextFromJks('keystore.jks', 'password'))
        .rejects.toThrow(GluesyncSSLError);
    });
    
    test('should handle missing certificate files', async () => {
      // Mock JSZip.loadAsync to return a zip with missing files
      const mockZip = {
        files: {}
      };
      (JSZip.loadAsync as jest.Mock).mockResolvedValue(mockZip);
      
      // Expect the function to throw an SSL error
      await expect(createSslContextFromJks('keystore.jks', 'password'))
        .rejects.toThrow(GluesyncSSLError);
    });
  });
  
  describe('createTimeout', () => {
    test('should create a promise that resolves after the specified time', async () => {
      // Mock setTimeout
      jest.useFakeTimers();
      
      // Create a timeout promise
      const timeoutPromise = createTimeout(1000, 'Timeout message');
      
      // Advance timers
      jest.advanceTimersByTime(1000);
      
      // Verify that the promise resolves with the message
      await expect(timeoutPromise).resolves.toBe('Timeout message');
      
      // Restore timers
      jest.useRealTimers();
    });
  });
  
  describe('getErrorFromCloseReason', () => {
    test('should return the close reason if provided', () => {
      const reason = 'Authentication failed';
      expect(getErrorFromCloseReason(reason)).toBe('Authentication failed');
    });
    
    test('should return a default message if reason is empty', () => {
      expect(getErrorFromCloseReason('')).toBe('Connection closed');
    });
  });
  
  describe('generateRandomId', () => {
    test('should generate a random ID of the specified length', () => {
      const id = generateRandomId(10);
      expect(id.length).toBe(10);
      expect(typeof id).toBe('string');
    });
    
    test('should generate different IDs on each call', () => {
      const id1 = generateRandomId(10);
      const id2 = generateRandomId(10);
      expect(id1).not.toBe(id2);
    });
  });
});
